# redist

[![Build Status](https://travis-ci.org/rogermadjos/redist.svg?branch=master)](https://travis-ci.org/rogermadjos/redist)

## How to install

```
npm install redist --save
```

`redist` allows you to easily handle redis transactions.

## How to use
```js
var redist = require('redist')();

var transact = redist.transact(function(read, done) {
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

transact.on('error', function(err) {
	// when error occurs
});

transact.on('retry', function(num) {
	// num - number of retries
});

transact.on('end', function(results) {
	// when transaction ends
});

```

## Options

`redist` also accepts options
```js
var redist = require('../index')(opts);
```
- `maxRetries`(`10`) - maximum number of retries before `redist` returns an error.
- `backoff` - object containing options for exponential backoff strategy.
	- `initialDelay`(`50`) - delay of the first retry.
	- `maxDelay`(`5000`) - maximum delay.
	- `factor`(`2`) - must be greater than 1.
	- `randomizationFactor`(`0.2`) - must be between 0 and 1.

For other options, please see [`redisp`](https://www.npmjs.com/package/redisp).

## License

MIT
