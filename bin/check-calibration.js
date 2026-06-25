#!/usr/bin/env node
// check-calibration — run the Spine calibration validators over files and exit non-zero if any
// BLOCKER (assumption laundering or a source-tier ceiling violation) is found. The reviewer runs
// this as a gate (see agents/reviewer.md). Zero-dep beyond src/calibration.js.
//
//   node bin/check-calibration.js <file...>                 # marker + tier checks per file
//   node bin/check-calibration.js --forward <source> <derived>   # assumption-laundering check

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  validateMarkers,
  validateTiers,
  validateMarkerForwarding,
  renderViolations,
  partition,
} from '../src/calibration.js';

/** Run marker + tier validators over each file (read injectable for tests). */
export function collectFileViolations(files, read = (f) => readFileSync(f, 'utf8')) {
  const all = [];
  for (const f of files) {
    const content = read(f);
    all.push(...validateMarkers(f, content), ...validateTiers(f, content));
  }
  return all;
}

/** Run the cross-file assumption-laundering check (source → derived). */
export function collectForwarding(sourceFile, derivedFile, read = (f) => readFileSync(f, 'utf8')) {
  return validateMarkerForwarding(read(sourceFile), read(derivedFile), sourceFile, derivedFile);
}

function main(argv = process.argv.slice(2)) {
  let violations;
  if (argv[0] === '--forward') {
    const [, source, derived] = argv;
    if (!source || !derived) {
      process.stderr.write('usage: check-calibration --forward <source> <derived>\n');
      process.exit(2);
    }
    violations = collectForwarding(source, derived);
  } else if (argv.length > 0) {
    violations = collectFileViolations(argv);
  } else {
    process.stderr.write('usage: check-calibration <file...> | --forward <source> <derived>\n');
    process.exit(2);
  }

  process.stdout.write(renderViolations(violations) + '\n');
  const { blockers } = partition(violations);
  process.exit(blockers.length > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
