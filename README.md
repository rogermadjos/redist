# redist

[![Build Status](https://travis-ci.org/rogermadjos/redist.svg?branch=master)](https://travis-ci.org/rogermadjos/redist)

## How to install

```
npm install redist --save
```

`redist` allows you to easily and safely handle redis transactions.

## How to use
```js
var redist = require('../index')();

redist(function(read, done) {
	// redis read operations
	read.smembers('users').now(function(err, results) {
		read.group();
		results.forEach(function(id) {
			read.get('users:'+id+':balance');
		});
		read.ungroup();
		done();
	});
}, function(write, results, done) {
	// redis write operations
	var total = 0;
	results[1].forEach(function(balance) {
		total += parseFloat(balance);
	});
	write.set('total', total);
	done(null, total);
}, function(err, result) {
	// finished
});

```

## License

MIT
