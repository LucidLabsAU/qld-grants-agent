import { afterEach, describe, expect, it } from 'vitest';
import { argValue, positionalArgs } from '../scripts/env.js';

const argv = process.argv;
afterEach(() => { process.argv = argv; });

describe('script arguments', () => {
  it('excludes deployment values from the query scenario and text', () => {
    process.argv = ['node', 'script', '-g', 'rg-grants', '--deployment', 'main', 'hybrid', 'drought', '--raw'];
    expect(positionalArgs()).toEqual(['hybrid', 'drought']);
  });

  it.each([['--agent'], ['--agent', '--debug']])('rejects missing flag values: %j', (...args) => {
    process.argv = ['node', 'script', ...args];
    expect(() => argValue('--agent')).toThrow(/Missing value/);
  });
});
