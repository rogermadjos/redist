'use strict';

var expect = require( 'chai' ).expect;
var redist = require( '../index' )();
var Read = require( '../libs/read' );
var async  = require( 'async' );
var _ = require( 'lodash' );

var pool = redist.pool;

describe( 'Redis Transaction', function() {

  before( function( done ) {
    pool.acquire( function( err, conn ) {
      if ( err ) {
        return done( err );
      }
      conn.flushdb( function( err ) {
        if ( err ) {
          return done( err );
        }
        async.times( 10, function( index, callback ) {
          conn.set( 'key:' + index, 'value:' + index, callback );
        }, function( err ) {
          if ( err ) {
            return done( err );
          }
          pool.release( conn );
          done();
        } );
      } );
    } );
  } );

  describe( 'Read', function() {
    it( 'should execute command', function( done ) {
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        get: [ 'conn', function( callback, results ) {
          var read = new Read( results.conn );
          var cmd = {
            command: 'get',
            args: [ 'key:0' ]
          };
          read.exec( cmd, callback );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.get ).to.equal( 'value:0' );
        done();
      } );
    } );
    it( 'should return the results of multiple read operations', function( done ) {
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        get: [ 'conn', function( callback, results ) {
          var read = new Read( results.conn );
          _.times( 10, function( index ) {
            read.get( 'key:' + ( 9 - index ) );
          } );
          read.execAll( callback );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.get ).to.deep.equal( _.map( _.range( 10 ), function( index ) {
          return 'value:' + ( 9 - index );
        } ) );
        done();
      } );
    } );
    it( 'should group together the results of multiple read operations', function( done ) {
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        get: [ 'conn', function( callback, results ) {
          var read = new Read( results.conn );
          read.group();
          _.times( 10, function( index ) {
            read.get( 'key:' + index );
          } );
          read.ungroup();
          read.execAll( callback );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.get.length ).to.equal( 1 );
        expect( results.get[ 0 ] ).to.deep.equal( _.map( _.range( 10 ), function( index ) {
          return 'value:' + index;
        } ) );
        done();
      } );
    } );
    it( 'should group together the results of multiple read operations', function( done ) {
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        get: [ 'conn', function( callback, results ) {
          var read = new Read( results.conn );
          _.times( 4, function( index ) {
            read.get( 'key:' + index );
          } );
          read.group();
          _.times( 2, function( index ) {
            read.get( 'key:' + ( index + 4 ) );
          } );
          read.ungroup();
          read.group();
          _.times( 2, function( index ) {
            read.get( 'key:' + ( index + 6 ) );
          } );
          read.ungroup();
          _.times( 2, function( index ) {
            read.get( 'key:' + ( index + 8 ) );
          } );
          read.execAll( callback );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.get.length ).to.equal( 8 );
        expect( results.get ).to.deep.equal( [
          'value:0',
          'value:1',
          'value:2',
          'value:3',
          [ 'value:4', 'value:5' ],
          [ 'value:6', 'value:7' ],
          'value:8',
          'value:9' ] );
        done();
      } );
    } );
    it( 'should immediately return the result of read operation', function( done ) {
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        get: [ 'conn', function( callback, results ) {
          var read = new Read( results.conn );
          _.times( 4, function( index ) {
            read.get( 'key:' + index );
          } );
          callback( null, read );
        } ],
        now: [ 'get', function( callback, results ) {
          var read = results.get;
          read.group();
          _.times( 2, function( index ) {
            read.get( 'key:' + ( index + 4 ) );
          } );
          read.ungroup();
          read.now( callback );
        } ],
        end: [ 'now', function( callback, results ) {
          var read = results.get;
          read.group();
          _.times( 2, function( index ) {
            read.get( 'key:' + ( index + 6 ) );
          } );
          read.ungroup();
          _.times( 2, function( index ) {
            read.get( 'key:' + ( index + 8 ) );
          } );
          read.execAll( callback );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.end.length ).to.equal( 8 );
        expect( results.now ).to.deep.equal( [ 'value:4', 'value:5' ] );
        expect( results.end ).to.deep.equal( [
          'value:0',
          'value:1',
          'value:2',
          'value:3',
          [ 'value:4', 'value:5' ],
          [ 'value:6', 'value:7' ],
          'value:8',
          'value:9' ] );
        done();
      } );
    } );
  } );

  describe( 'Transaction', function() {
    it( 'should be able to perform a simple redis transaction', function( done ) {
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        set: [ 'conn', function( callback, results ) {
          results.conn.set( 'test', 5, callback );
        } ],
        transact: [ 'set', function( callback ) {
          redist.transact( function( read, callback ) {
            read.get( 'test' );
            callback();
          }, function( write, results, callback ) {
            var number = +results[ 0 ] * 5;
            write.set( 'test', number );
            callback( null, number );
          }, function( err, results ) {
            callback( err, results );
          } );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.transact ).to.equal( 25 );
        done();
      } );
    } );

    it( 'should handle error correctly', function( done ) {
      redist.transact( function( read, callback ) {
        var err = new Error( 'error' );
        err.code = 'ERR';
        callback( err );
      }, function( write, results, callback ) {
        callback();
      }, function( err ) {
        expect( err.code ).to.equal( 'ERR' );
        expect( err.message ).to.equal( 'error' );
        done();
      } );
    } );

    it( 'should handle error correctly', function( done ) {
      redist.transact( function( read, callback ) {
        callback();
      }, function( write, results, callback ) {
        var err = new Error( 'error' );
        err.code = 'ERR';
        callback( err );
      }, function( err ) {
        expect( err.code ).to.equal( 'ERR' );
        expect( err.message ).to.equal( 'error' );
        done();
      } );
    } );

    it( 'should retry transaction when interrupted', function( done ) {
      this.timeout( 5000 );
      async.auto( {
        conn: function( callback ) {
          pool.acquire( callback );
        },
        set: [ 'conn', function( callback, results ) {
          results.conn.set( 'test', 5, callback );
        } ],
        transact1: [ 'set', function( callback ) {
          redist.transact( function( read, callback ) {
            read.get( 'test' );
            callback();
          }, function( write, results, callback ) {
            var number = +results[ 0 ] * 5;
            write.set( 'test', number );
            setTimeout( function() {
              callback( null, number );
            }, 500 );
          }, function( err, results ) {
            callback( err, results );
          } );
        } ],
        transact2: [ 'set', function( callback ) {
          setTimeout( function() {
            redist.transact( function( read, callback ) {
              read.get( 'test' );
              callback();
            }, function( write, results, callback ) {
              var number = +results[ 0 ] * 5;
              write.set( 'test', number );
              callback( null, number );
            }, function( err, results ) {
              callback( err, results );
            } );
          }, 250 );
        } ]
      }, function( err, results ) {
        if ( results.conn ) {
          pool.release( results.conn );
        }
        if ( err ) {
          return done( err );
        }
        expect( results.transact1 ).to.equal( 125 );
        expect( results.transact2 ).to.equal( 25 );
        done();
      } );
    } );
  } );

  describe( 'Stress Testing', function() {
    it( 'should correctly handle multiple transactions', function( done ) {
      this.timeout( 10000 );
      var numbers = [];
      var x = 5, y = 5;
      async.times( x, function( index, callback ) {
        async.timesSeries( y, function( index, callback ) {
          redist.transact( function( read, callback ) {
            read.get( 'number' );
            callback();
          }, function( write, results, callback ) {
            var number = +results[ 0 ];
            var incr = Math.floor( Math.random() * 10 ) + 1;
            write.incrby( 'number', incr );
            setTimeout( function() {
              callback( null, number );
            }, Math.random() * 250 );
          }, function( err, result ) {
            if ( err ) {
              callback( err );
            }
            numbers.push( result );
            callback();
          } );
        }, callback );
      }, function( err ) {
        if ( err ) {
          return done( err );
        }
        expect( _.uniq( numbers ).length ).to.equal( x * y );
        done();
      } );
    } );
  } );
} );
