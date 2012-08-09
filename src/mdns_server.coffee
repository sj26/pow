# Pow's `mDnsServer` is designed to respond to mDNS `A` queries with
# the interface's address for all subdomains of the specified
# top-level domain. We can't use mDNSResponder as it will not
# register additional `A` records.

# XXX: We SHOULD listen on each interface seperately so we can
# respond with the appropriate IP to the multicast address over
# that interface. For now, it's hacked a little and will look up
# the address we'd use to contact the sender via `route` and
# `ifconfig`.

dnsserver = require "dnsserver"
util = require "util"
{exec} = require "child_process"

NS_T_A  = 1
NS_C_IN = 1
NS_RCODE_NXDOMAIN = 3

module.exports = class mDnsServer extends dnsserver.Server
  # Create a `mDnsServer` with the given `Configuration` instance. The
  # server installs a single event handler for responding to mDNS
  # queries.
  constructor: (@configuration) ->
    super
    @on "request", @handleRequest

  # `lookupHostname` looks up our hostname that should be
  # registered as an mDNS address. Can be overridden by
  # `@configuration.mDnsHost`.
  lookupHostname: (callback) ->
    if @configuration.mDnsHost != null
      callback? null, @configuration.mDnsHost
    else
      exec "scutil --get LocalHostName", (error, stdout, stderr) =>
        return callback? error if error
        hostname = stdout.trim()
        callback? null, hostname

  lookupAddressToContactInterfacePattern = /interface:\s+(\S+)/i
  lookupAddressToContactAddressPattern = /inet\s+(\d+\.\d+\.\d+\.\d+)/i
  lookupAddressToContact: (address, callback) ->
    # XXX: We can't actually do this... it needs to be scoped by interface and things.
    # ("default" used to be "#{address}")
    # Only one address can be published per interface due to multicasting.
    # Node also currently has no nice way to inspect interfaces, etc.
    exec "/sbin/route get default", (error, stdout, stderr) =>
      iface = stdout.match(lookupAddressToContactInterfacePattern)?[1]
      return callback? error if error or not iface
      exec "/sbin/ifconfig #{iface}", (error, stdout, stderr) =>
        myAddress = stdout.match(lookupAddressToContactAddressPattern)?[1]
        return callback? error if error or not myAddress
        callback? null, myAddress

  # The `listen` method is just a wrapper around `bind` that makes
  # `mDnsServer` quack like a `HttpServer` (for initialization, at
  # least).
  listen: (port, callback) ->
    @lookupHostname (error, hostname) =>
      return callback? error if error

      # listen to queries for A records matching *.hostname.local
      @pattern = /// (^|\.) #{hostname} \. #{@configuration.mDnsDomain} \.? ///i

      @bind @configuration.mDnsPort

      @setMulticastLoopback true
      @addMembership @configuration.mDnsAddress

      mDnsHost = "#{hostname}.#{@configuration.mDnsDomain}".toLowerCase()
      @configuration.addToAllDomains mDnsHost

      callback?()

  # Each incoming mDNS request ends up here. If it's an unanswered `A`
  # query and the domain name is a subdomain of our mDNS name, we
  # respond with find the IP used to route to the receiver. All other
  # requests are ignored.
  handleRequest: (req, res) =>
    return unless req.header.qdcount > 0 and req.header.ancount < req.header.qdcount

    {question} = req

    return unless question.type is NS_T_A and question.class is NS_C_IN and @pattern.test question.name

    @lookupAddressToContact res.rinfo.address, (error, myAddress) =>
      return if error

      res.addRR question.name, NS_T_A, NS_C_IN, 600, myAddress

      buffer = res.toBuffer()
      res.socket.send buffer, 0, buffer.length, @configuration.mDnsPort, @configuration.mDnsAddress

  # TODO: Hostname change monitoring

  # TODO: Goodbye messages
