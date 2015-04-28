# redist

[![Build Status](https://travis-ci.org/rogermadjos/redist.svg?branch=master)](https://travis-ci.org/rogermadjos/redist)

## How to install

```
npm install redist --save
```

`redist` allows you to easily handle redis transactions.

## How to use
```js
var redist = require('../index')();

redist(function(read, done) {
	// read block
	read.smembers('users').now(function(err, results) {
		read.group();
		results.forEach(function(id) {
			read.get('users:'+id+':balance');
		});
		read.ungroup();
		done();
	});
}, function(write, results, done) {
	// write block
	var total = 0;
	results[1].forEach(function(balance) {
		total += parseFloat(balance);
	});
	write.set('total_balance', total);
	done(null, total);
}, function(err, result) {
	// finished
});

```

## Options

`redist` also accepts options
```js
var redist = require('../index')(opts);
```
- `maxRetries`(`10`) - maximum number of retries before `redist` returns an error.
- `retryDelay`(`50`) - number of milliseconds to wait before next try is attempted.
- `backoff`(`false`) - determines whether to progressively increase `retryDelay`. If set to `true`, `retryDelay` is multiplied by the number of retries.

For other options, please see [`redisp`](https://www.npmjs.com/package/redisp).

## License

MIT
