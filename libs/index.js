/*jshint node:true */
'use strict';

var _ = require('lodash');
var Read = require('./read');
var async = require('async');
var domain = require('domain');
var debug = require('debug')('redist:transact');
var util = require('util');
var events = require('events');

function Redist(opts) {
  opts = opts || {};
  this.maxRetries = opts.maxRetries || 10;
  this.backoff = _.assign({
    initialDelay: 50,
    maxDelay: 5000,
    factor: 1.5,
    randomizationFactor: 0.5
  }, opts.backoff || {});
  this.pool = require('redisp')(opts);
}

util.inherits(Redist, events.EventEmitter);

var transaction = function(conn, readF, writeF, callback) {
  async.auto({
    read: function(callback) {
      var read = new Read(conn);
      var d = domain.create();
      d.on('error', function(err) {
        err.code = 'ERR_FATAL';
        callback(err);
      });
      d.run(function() {
        readF(read, function(err) {
          if(err) return callback(err);
          read.execAll(callback);
        });
      });
    },
    write: ['read', function(callback, results) {
      var multi = conn.multi();
      var d = domain.create();
      d.on('error', function(err) {
        err.code = 'ERR_FATAL';
        callback(err);
      });
      d.run(function() {
        writeF(multi, results.read, function(err, obj) {
          callback(err, {
            multi: multi,
            result: obj
          });
        });
      });
    }],
    exec: ['write', function(callback, results) {
      results.write.multi.exec(callback);
    }]
  }, callback);
};

Redist.prototype.transact = function(readF, writeF, endF) {
  var self = this;
  var retryCount = 0;
  var lastDelay = 0;
  async.auto({
    conn: function(callback) {
      self.pool.borrow(callback);
    },
    transact: ['conn', function(callback, results) {
      var conn = results.conn;
      var operation = function() {
        transaction(conn, readF, writeF, function(err, results) {
          if(err) return callback(err);
          if(results.exec) {
            debug('end: %o %o', results.write.result, results.exec);
            callback(null, results);
          }
          else {
            if(retryCount >= self.maxRetries) {
              err = new Error('Maximum number of retries reached');
              err.code = 'ERR_FATAL';
              callback(err);
            }
            else {
              var delay = self.backoff.initialDelay * Math.pow(self.backoff.factor, retryCount++);
              var randomAdd = (delay - lastDelay) * Math.random() * self.backoff.randomizationFactor;
              lastDelay = delay;
              delay += randomAdd * ((Math.random() > 0.5)?1:-1);
              setTimeout(function() {
                debug('retry: %d', retryCount);
                self.emit('retry', retryCount);
                operation();
              }, delay);
            }
          }
        });
      };
      operation();
    }]
  }, function(err, results) {
    if(results.conn) {
      results.conn.unwatch(function() {
        results.conn.release();
      });
    }
    if(err) return endF(err);
    endF(null, results.transact.write.result, results.transact.exec);
  });
};

module.exports = function(opts) {
  return new Redist(opts);
};

module.exports.Redist = Redist;
