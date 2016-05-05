/*jshint node:true */
'use strict';

var _ = require( 'lodash' );
var Read = require( './read' );
var async = require( 'async' );
var debug = require( 'debug' )( 'redist:transact' );
var EventEmitter = require( 'events' ).EventEmitter;
var Pool = require( 'generic-pool' ).Pool;
var redis = require( 'redis' );

function Redist ( opts ) {
  opts = opts || {};
  this.maxRetries = opts.maxRetries || 10;
  this.maxConnections = opts.maxConnections || 25;
  this.backoff = _.assign( {
    initialDelay: 50,
    maxDelay: 5000,
    factor: 2,
    randomizationFactor: 0.2
  }, opts.backoff || {} );
  this.count = 0;
  this.pool = new Pool( {
    name: 'redis',
    create: function( callback ) {
      var conn = redis.createClient( opts );
      callback( null, conn );
    },
    destroy: function( conn ) {
      conn.quit();
    },
    max: this.maxConnections,
    idleTimeoutMillis: 60000
  } );
}

var transaction = function( conn, readF, writeF, callback ) {
  async.auto( {
    read: function( callback ) {
      var read = new Read( conn );
      callback = _.once( callback );
      readF( read, function( err ) {
        if ( err ) {
          return callback( err );
        }
        read.execAll( callback );
      } );
    },
    write: [ 'read', function( callback, results ) {
      var multi = conn.multi();
      callback = _.once( callback );
      writeF( multi, results.read, function( err, obj ) {
        callback( err, {
          multi: multi,
          result: obj
        } );
      } );
    } ],
    exec: [ 'write', function( callback, results ) {
      results.write.multi.exec( callback );
    } ]
  }, callback );
};

Redist.prototype.transact = function( readF, writeF, endF ) {
  var self = this;
  var retryCount = 0;
  var emitter = new EventEmitter();
  emitter.on( 'error', _.noop );
  var id = this.count++;
  debug( 'started: %o', { id:id } );
  var timestamp = Date.now();
  endF = endF || _.noop;
  async.auto( {
    conn: function( callback ) {
      self.pool.acquire( callback );
    },
    transact: [ 'conn', function( callback, results ) {
      var conn = results.conn;
      var operation = function() {
        transaction( conn, readF, writeF, function( err, results ) {
          if ( err ) {
            return callback( err );
          }
          if ( results.exec ) {
            callback( null, results );
          } else {
            if ( retryCount >= self.maxRetries ) {
              err = new Error( 'Maximum number of retries reached' );
              err.code = 'ERR_FATAL';
              callback( err );
            } else {
              var delay = self.backoff.initialDelay * Math.pow( self.backoff.factor, retryCount++ );
              delay += delay * Math.random() * self.backoff.randomizationFactor * ( ( Math.random() > 0.5 ) ? 1 : -1 );
              delay = Math.min( delay, self.backoff.maxDelay );
              setTimeout( function() {
                debug( 'retry: %o', { id: id, retryCount: retryCount } );
                emitter.emit( 'retry', retryCount );
                operation();
              }, delay );
            }
          }
        } );
      };
      operation();
    } ]
  }, function( err, results ) {
    if ( results.conn ) {
      results.conn.unwatch( function( err ) {
        self.pool.release( results.conn );
        if ( err ) {
          emitter.emit( 'error', err );
        }
      } );
    }
    if ( err ) {
      emitter.emit( 'error', err );
      return endF( err );
    }
    debug( 'end: %o', {
      id: id,
      results: results.transact.write.result,
      execResults: results.transact.exec,
      execTime: Date.now() - timestamp
    } );
    emitter.emit( 'end', {
      results: results.transact.write.result,
      execResults: results.transact.exec
    } );
    endF( null, results.transact.write.result, results.transact.exec );
  } );
  return emitter;
};

module.exports = function( opts ) {
  return new Redist( opts );
};

module.exports.Redist = Redist;
