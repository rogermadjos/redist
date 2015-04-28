/*jshint node:true */
'use strict';

var _ = require('lodash');
var Read = require('./read');
var async = require('async');
var domain = require('domain');
var debug = require('debug')('redist:transact');

function Redist(opts) {
  opts = opts || {};
  this.maxRetries = opts.maxRetries || 10;
  this.retryDelay = opts.retryDelay || 50;
  this.retryCount = 0;
  this.pool = require('redisp')(opts);
}

Redist.prototype.transact = function(readF, writeF, endF) {
  var self = this;
  var retryCount = 0;
  async.auto({
    conn: function(callback) {
      self.pool.borrow(callback);
    },
    read: ['conn', function(callback, results) {
      var read = new Read(results.conn);
      var d = domain.create();
      d.on('error', function(err) {
        callback(err);
      });
      d.run(function() {
        readF(read, function(err) {
          if(err) return callback(err);
          read.execAll(callback);
        });
      });
    }],
    write: ['read', function(callback, results) {
      var multi = results.conn.multi();
      var d = domain.create();
      d.on('error', function(err) {
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
  }, function(err, results) {
    if(results.conn) {
      results.conn.unwatch(function(err) {
        results.conn.release();
        if(err) endF(err);
      });
    }
    if(err) return endF(err);
    //interrupted
    if(!results.exec) {
      retryCount++;
      debug('retry: %d', retryCount);
      if(retryCount > self.maxRetries)
        return endF(new Error('Maximum number of retries reached'));
      var delay = self.retryDelay * retryCount;
      setTimeout(function() {
        self.transact(readF, writeF, endF);
      }, delay * 0.85 + Math.random() * 0.3);
    }
    else {
      debug('end: %s', JSON.stringify(results.write.result));
      endF(null, results.write.result);
    }
  });
};

module.exports = function(opts) {
  return new Redist(opts);
};

module.exports.Redist = Redist;
