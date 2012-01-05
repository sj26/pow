(function() {
  var NS_C_IN, NS_RCODE_NXDOMAIN, NS_T_A, dnsserver, exec, inspect, mDnsServer,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = Object.prototype.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor; child.__super__ = parent.prototype; return child; };

  dnsserver = require("dnsserver");

  inspect = require("util").inspect;

  exec = require("child_process").exec;

  NS_T_A = 1;

  NS_C_IN = 1;

  NS_RCODE_NXDOMAIN = 3;

  module.exports = mDnsServer = (function(_super) {
    var lookupAddressToContactAddressPattern, lookupAddressToContactInterfacePattern;

    __extends(mDnsServer, _super);

    function mDnsServer(configuration) {
      this.configuration = configuration;
      this.handleRequest = __bind(this.handleRequest, this);
      mDnsServer.__super__.constructor.apply(this, arguments);
      this.logger = this.configuration.getLogger('mdns');
      this.on("request", this.handleRequest);
    }

    mDnsServer.prototype.lookupHostname = function(callback) {
      var _this = this;
      if (this.configuration.mDnsHost !== null) {
        return typeof callback === "function" ? callback(null, this.configuration.mDnsHost) : void 0;
      } else {
        return exec("scutil --get LocalHostName", function(error, stdout, stderr) {
          var hostname;
          if (error) {
            _this.logger.warning("Couldn't query local hostname. scutil said: " + (inspect(stdout)) + " and " + (inspect(stderr)));
            return typeof callback === "function" ? callback(true) : void 0;
          } else {
            hostname = stdout.trim();
            return typeof callback === "function" ? callback(null, hostname) : void 0;
          }
        });
      }
    };

    lookupAddressToContactInterfacePattern = /interface:\s+(\S+)/i;

    lookupAddressToContactAddressPattern = /inet\s+(\d+\.\d+\.\d+\.\d+)/i;

    mDnsServer.prototype.lookupAddressToContact = function(address, callback) {
      var _this = this;
      return exec("route get default", function(error, stdout, stderr) {
        var interface, _ref;
        interface = (_ref = stdout.match(lookupAddressToContactInterfacePattern)) != null ? _ref[1] : void 0;
        if (error || !interface) {
          _this.logger.warning("Couldn't query route for " + address + ". route said: " + (inspect(stdout)) + " and " + (inspect(stderr)));
          return typeof callback === "function" ? callback(true, null) : void 0;
        } else {
          return exec("ifconfig " + interface, function(error, stdout, stderr) {
            var myAddress, _ref2;
            myAddress = (_ref2 = stdout.match(lookupAddressToContactAddressPattern)) != null ? _ref2[1] : void 0;
            if (error || !myAddress) {
              _this.logger.warning("Couldn't query address for " + interface + ". ifconfig said: " + (inspect(stdout)) + " and " + (inspect(stderr)));
              return typeof callback === "function" ? callback(true, null) : void 0;
            } else {
              return typeof callback === "function" ? callback(null, myAddress) : void 0;
            }
          });
        }
      });
    };

    mDnsServer.prototype.listen = function(port, callback) {
      var _this = this;
      return this.lookupHostname(function(error, hostname) {
        var mDnsHost;
        _this.pattern = RegExp("(^|\\.)" + hostname + "\\." + _this.configuration.mDnsDomain + "\\.?", "i");
        _this.logger.debug("multicasting on " + _this.configuration.mDnsAddress);
        _this.setTTL(255);
        _this.setMulticastTTL(255);
        _this.setMulticastLoopback(true);
        _this.addMembership(_this.configuration.mDnsAddress);
        _this.logger.debug("binding to port " + _this.configuration.mDnsPort);
        _this.bind(_this.configuration.mDnsPort);
        mDnsHost = ("" + hostname + "." + _this.configuration.mDnsDomain).toLowerCase();
        _this.logger.debug("adding mDNS domain " + (inspect(mDnsHost)) + " to configuration");
        _this.configuration.addExtDomain(mDnsHost);
        return typeof callback === "function" ? callback() : void 0;
      });
    };

    mDnsServer.prototype.handleRequest = function(req, res) {
      var question, _ref,
        _this = this;
      question = (_ref = req.question) != null ? _ref : {};
      if (req.ancount || question.type !== NS_T_A || question["class"] !== NS_C_IN || !this.pattern.test(question.name)) {
        return;
      }
      return this.lookupAddressToContact(res.rinfo.address, function(error, myAddress) {
        var buffer;
        if (error) {
          return _this.logger.warning("couldn't find my address to talk to " + res.rinfo.address);
        } else {
          res.header.aa = 1;
          res.addRR(question.name, NS_T_A, NS_C_IN, 600, myAddress);
          buffer = res.toBuffer();
          return res.socket.send(buffer, 0, buffer.length, 5353, '224.0.0.251', function(error) {
            if (error) {
              return this.logger.warning("couldn't send mdns response: " + (inspect(error)));
            }
          });
        }
      });
    };

    return mDnsServer;

  })(dnsserver.Server);

}).call(this);
