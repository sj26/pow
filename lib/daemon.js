(function() {
  var Daemon, DnsServer, EventEmitter, HttpServer, mDnsServer,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = Object.prototype.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor; child.__super__ = parent.prototype; return child; };

  EventEmitter = require("events").EventEmitter;

  HttpServer = require("./http_server");

  DnsServer = require("./dns_server");

  mDnsServer = require("./mdns_server");

  module.exports = Daemon = (function(_super) {

    __extends(Daemon, _super);

    function Daemon(configuration) {
      this.configuration = configuration;
      this.stop = __bind(this.stop, this);
      this.httpServer = new HttpServer(this.configuration);
      this.dnsServer = new DnsServer(this.configuration);
      this.mDnsServer = new mDnsServer(this.configuration);
      process.on("SIGINT", this.stop);
      process.on("SIGTERM", this.stop);
      process.on("SIGQUIT", this.stop);
    }

    Daemon.prototype.start = function() {
      var dnsPort, flunk, httpPort, mDnsPort, pass, startServer, _ref,
        _this = this;
      if (this.starting || this.started) return;
      this.starting = true;
      startServer = function(server, port, callback) {
        return process.nextTick(function() {
          try {
            server.on('error', callback);
            server.once('listening', function() {
              server.removeListener('error', callback);
              return callback();
            });
            return server.listen(port);
          } catch (err) {
            return callback(err);
          }
        });
      };
      pass = function() {
        _this.starting = false;
        _this.started = true;
        return _this.emit("start");
      };
      flunk = function(err) {
        _this.starting = false;
        try {
          _this.httpServer.close();
        } catch (_error) {}
        try {
          _this.dnsServer.close();
        } catch (_error) {}
        try {
          _this.mDnsServer.close();
        } catch (_error) {}
        return _this.emit("error", err);
      };
      _ref = this.configuration, httpPort = _ref.httpPort, dnsPort = _ref.dnsPort, mDnsPort = _ref.mDnsPort;
      return startServer(this.httpServer, httpPort, function(err) {
        if (err) {
          return flunk(err);
        } else {
          return startServer(_this.dnsServer, dnsPort, function(err) {
            if (err) {
              return flunk(err);
            } else {
              return startServer(_this.mDnsServer, mDnsPort, function(err) {
                if (err) {
                  return flunk(err);
                } else {
                  return pass();
                }
              });
            }
          });
        }
      });
    };

    Daemon.prototype.stop = function() {
      var stopServer,
        _this = this;
      if (this.stopping || !this.started) return;
      this.stopping = true;
      stopServer = function(server, callback) {
        return process.nextTick(function() {
          var close;
          try {
            close = function() {
              server.removeListener("close", close);
              return callback(null);
            };
            server.on("close", close);
            return server.close();
          } catch (err) {
            return callback(err);
          }
        });
      };
      return stopServer(this.httpServer, function() {
        return stopServer(_this.dnsServer, function() {
          return stopServer(_this.mdnsServer, function() {
            _this.stopping = false;
            _this.started = false;
            return _this.emit("stop");
          });
        });
      });
    };

    return Daemon;

  })(EventEmitter);

}).call(this);
