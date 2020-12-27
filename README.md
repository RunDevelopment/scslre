# Single-character super-linear RegExps

<sup><sub>what a name...</sub></sup>

[![Actions Status](https://github.com/RunDevelopment/scslre/workflows/CI/badge.svg)](https://github.com/RunDevelopment/scslre/actions)
[![npm](https://img.shields.io/npm/v/scslre)](https://www.npmjs.com/package/scslre)

A library to find JS RegExp with super-linear worst-case time complexity for attack strings that repeat a single character.


## Usage

This library exports only a single function, `analyse`, which takes a RegExp literal and returns a list of reports that show the quantifiers causing super-linear worst-case time complexity.

For more information on the exact inputs and outputs of the function, see the documentation.


## Limitations

### Analysis

This library is implemented using a very limited static analysis method that can only find attack strings where a single character is repeated. Attack strings are generated from a tuple _(x,y,z)_ such that every string _s = xy<sup>n</sup>z_ (or `x + y.repeat(n) + z` for JS folks) takes _O(n<sup>p</sup>)_ or _O(2<sup>n</sup>)_ many steps to reject, p>1. This analysis method can only find tuples where _y_ is a single character. E.g. the polynomial backtracking in `/^(ab)*(ab)*$/` for _(x,y,z) = ("", "ab", "c")_ cannot be detected by this library because _y_ is not a single character.

However, this limitation allows the static analysis method to be quick and to provide good (but not perfect) support for backreferences and assertions (e.g. `\b`, `(?<!ba+)`).

### False negatives

The analysis method primarily searches for polynomial backtracking. Finds of exponential backtracking are only a byproduct. Because of this, not all causes of super-linear worst-case time complexity are found.

### False positives

This library doesn't actually search for the whole tuple _(x,y,z)_; it only searches for _y_ and assumes that adequate values for _x_ and _z_ can be found. A single-character approximation of the suffix _z_ will be computed and accounted for but false positives are still possible.


## Reports

There are 3 different types of reports that each indicate a different type of cause for the super-linear worst-case time complexity. All are explained in the documentation of their types.

### Exponential backtracking

While most reports show polynomial backtracking, some report exponential backtracking. Exponential backtracking is a lot more dangerous and can easily be exploited for [ReDoS attacks](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS).

While other reports may be dismissed, __all reports of exponential backtracking must be fixed__.

All reports with `exponential: true` report exponential backtracking.
