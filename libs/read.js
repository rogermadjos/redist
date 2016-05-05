/*jshint node:true */
'use strict';

var _ = require( 'lodash' );
var debug = require( 'debug' );
var async = require( 'async' );

var loggers = {
  watch: debug( 'redist:watch' ),
  exec: debug( 'redist:exec' ),
  command: debug( 'redist:command' )
};

var READ_CMDS = [
  'hexists', 'hget', 'hgetall', 'hkeys', 'hlen', 'hmget', 'hstrlen', 'hvals',
  'exists', 'lindex', 'llen', 'scard', 'sismember', 'smembers', 'srandmember',
  'zcard', 'zcount', 'zlexcount', 'zrange', 'zrangebylex', 'zrevrangebylex',
  'zrangebyscore', 'zrank', 'zrevrange', 'zrevrangebyscore', 'zrevrank', 'zscore',
  'get', 'getbit', 'getrange', 'strlen'
];

var READ_CMDS_MULT = [
  'sdiff', 'sinter', 'sunion', 'mget'
];

function Read ( conn ) {
  this.keys = [];
  this.conn = conn;
  this.commands = [];
  this.grouped = false;
}

//Attach read only commands
_.each( _.union( READ_CMDS, READ_CMDS_MULT ), function( command ) {
  Read.prototype[ command ] = function() {
    var self = this;
    var args;
    if ( _.isArray( arguments[ 0 ] ) ) {
      args = arguments[ 0 ];
    } else {
      args = _.toArray( arguments );
    }
    var cmd = {
      command: command,
      args: args
    };
    loggers.command( 'added: %s', JSON.stringify( cmd ) );
    if ( self.grouped ) {
      _.last( self.commands ).push( cmd );
    } else {
      this.commands.push( cmd );
    }
    return self;
  };
} );

//Execute all non-immediate commands
Read.prototype.execAll = function( callback ) {
  var self = this;
  async.map( self.commands, function( item, callback ) {
    if ( _.isArray( item ) ) {
      async.map( item, function( cmd, callback ) {
        self.exec( cmd, callback );
      }, callback );
    } else {
      if ( item.result ) {
        return callback( null, item.result );//Return immediately if result already exists
      }
      self.exec( item, callback );
    }
  }, callback );
};

Read.prototype.exec = function( cmd, callback ) {
  var self = this;
  self.watch( cmd, function( err ) {
    if ( err ) {
      return callback( err );
    }
    self.conn[ cmd.command ]( cmd.args, function( err, result ) {
      if ( err ) {
        return callback( err );
      }
      loggers.exec( '%s result: %s', JSON.stringify( cmd ), JSON.stringify( result ) );
      cmd.result = result;
      callback( null, result );
    } );
  } );
};

Read.prototype.watch = function( cmd, callback ) {
  var self = this;
  var keys;
  if ( _.contains( READ_CMDS_MULT, cmd.command ) ) {
    keys = cmd.args;
  } else {
    keys = [ cmd.args[ 0 ] ];
  }
  keys = _.difference( keys, self.keys );
  if ( keys.length === 0 ) {
    return callback();
  }
  this.conn.watch( keys, function( err ) {
    if ( err ) {
      return callback( err );
    }
    self.keys = _.union( self.keys, keys );
    loggers.watch( 'keys: %s', JSON.stringify( keys ) );
    callback();
  } );
};

// Immdediately call the last read operation
// used for dynamically determined read operations
Read.prototype.now = function( callback ) {
  var self = this;
  var last = _.last( self.commands );
  if ( _.isUndefined( last ) ) {
    callback();
  }
  // If last is a group
  if ( _.isArray( last ) ) {
    self.ungroup();
    if ( last.length === 0 ) {
      callback( null, [] );
    } else {
      async.map( last, function( cmd, callback ) {
        self.exec( cmd, callback );
      }, callback );
    }
  } else {
    self.exec( last, callback );
  }
  return self;
};

//Group together the results of multiple read operations
Read.prototype.group = function() {
  if ( !this.grouped ) {
    loggers.command( 'group' );
    this.grouped = true;
    this.commands.push( [] );
  }
  return this;
};

Read.prototype.ungroup = function() {
  if ( this.grouped ) {
    loggers.command( 'ungroup' );
  }
  this.grouped = false;
  return this;
};

module.exports = Read;
