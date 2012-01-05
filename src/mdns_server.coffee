# Pow's `mDnsServer` is designed to respond to mDNS `A` queries with
# `127.0.0.1` for all subdomains of the specified top-level domain.
# We can't use mDNSResponder as it will not register addition `A`
# records. Stricly, the mDNS draft recommends

# XXX: We SHOULD listen on each interface seperately so we can
# respond with the appropriate IP to the multicast address over
# that interface. For now, it's hacked a little and will look up
# the address we'd use to contact the sender via `route` and
# `ifconfig`.

dnsserver = require "dnsserver"

{inspect} = require "util"
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
    @logger = @configuration.getLogger 'mdns'
    @on "request", @handleRequest

  # `lookupHostname` looks up our hostname that should be
  # registered as an mDNS address. Can be overridden by
  # `@configuration.mDnsHost`.
  lookupHostname: (callback) ->
    if @configuration.mDnsHost != null
      callback? null, @configuration.mDnsHost
    else
      exec "scutil --get LocalHostName", (error, stdout, stderr) =>
        if error
          @logger.warning "Couldn't query local hostname. scutil said: #{inspect stdout} and #{inspect stderr}"
          callback? true
        else
          hostname = stdout.trim()
          callback? null, hostname

  lookupAddressToContactInterfacePattern = /interface:\s+(\S+)/i
  lookupAddressToContactAddressPattern = /inet\s+(\d+\.\d+\.\d+\.\d+)/i
  lookupAddressToContact: (address, callback) ->
    # XXX: We can't actually do this... it needs to be scoped by interface and things.
    # ("default" used to be "#{address}")
    # Only one address can be published per interface due to multicasting.
    # Node also currently has no nice way to inspect interfaces, etc.
    # Should use SystemConfiguration framework
    exec "route get default", (error, stdout, stderr) =>
      interface = stdout.match(lookupAddressToContactInterfacePattern)?[1]
      if error or not interface
        @logger.warning "Couldn't query route for #{address}. route said: #{inspect stdout} and #{inspect stderr}"
        callback? true, null
      else
        exec "ifconfig #{interface}", (error, stdout, stderr) =>
          myAddress = stdout.match(lookupAddressToContactAddressPattern)?[1]
          if error or not myAddress
            @logger.warning "Couldn't query address for #{interface}. ifconfig said: #{inspect stdout} and #{inspect stderr}"
            callback? true, null
          else
            callback? null, myAddress

  # The `listen` method is just a wrapper around `bind` that makes
  # `mDnsServer` quack like a `HttpServer` (for initialization, at
  # least).
  listen: (port, callback) ->
    @lookupHostname (error, hostname) =>
      # listen to queries for A records matching *.hostname.local
      @pattern = /// (^|\.) #{hostname} \. #{@configuration.mDnsDomain} \.? ///i

      @logger.debug "multicasting on #{@configuration.mDnsAddress}"
      @setTTL 255
      @setMulticastTTL 255
      @setMulticastLoopback true
      @addMembership @configuration.mDnsAddress

      @logger.debug "binding to port #{@configuration.mDnsPort}"
      @bind @configuration.mDnsPort

      mDnsHost = "#{hostname}.#{@configuration.mDnsDomain}".toLowerCase()
      @logger.debug "adding mDNS domain #{inspect mDnsHost} to configuration"
      @configuration.addExtDomain mDnsHost

      callback?()

  # Each incoming mDNS request ends up here. If it's an unanswered `A`
  # query and the domain name is a subdomain of our mDNS name, we
  # respond with find the IP used to route to the receiver. All other
  # requests are ignored.
  handleRequest: (req, res) =>
    question = req.question ? {}

    return if req.ancount or question.type isnt NS_T_A or question.class isnt NS_C_IN or not @pattern.test question.name

    # Figure out what address they can reach us via
    @lookupAddressToContact res.rinfo.address, (error, myAddress) =>
      if error
        @logger.warning "couldn't find my address to talk to #{res.rinfo.address}"
      else
        res.header.aa = 1
        res.addRR question.name, NS_T_A, NS_C_IN, 600, myAddress

        # Override send method to multicast
        buffer = res.toBuffer()
        res.socket.send buffer, 0, buffer.length, 5353, '224.0.0.251', (error) ->
          if error
            @logger.warning "couldn't send mdns response: #{inspect error}"

  # TODO: Hostname and interface change monitoring
  # Use Apple SystemConfiguration framework monitoring

  # TODO: Goodbye messages
