<p align="center">
  <a href="https://sentry.io" target="_blank" align="center">
    <img src="https://sentry-brand.storage.googleapis.com/sentry-logo-black.png" width="280">
  </a>
  <br />
</p>

# Official Sentry SDK for Electron

[![Travis](https://img.shields.io/travis/getsentry/sentry-electron.svg?maxAge=2592000)](https://travis-ci.org/getsentry/sentry-electron)
[![AppVeyor](https://img.shields.io/appveyor/ci/sentry/sentry-electron.svg)](https://ci.appveyor.com/project/sentry/sentry-electron)
[![npm version](https://img.shields.io/npm/v/@sentry/electron.svg)](https://www.npmjs.com/package/@sentry/electron)
[![license](https://img.shields.io/github/license/getsentry/sentry-electron.svg)](https://github.com/getsentry/sentry-electron/blob/master/LICENSE)

[![deps](https://david-dm.org/getsentry/sentry-electron/status.svg)](https://david-dm.org/getsentry/sentry-electron?view=list)
[![deps dev](https://david-dm.org/getsentry/sentry-electron/dev-status.svg)](https://david-dm.org/getsentry/sentry-electron?type=dev&view=list)
[![deps peer](https://david-dm.org/getsentry/sentry-electron/peer-status.svg)](https://david-dm.org/getsentry/sentry-electron?type=peer&view=list)

## Usage

To use this SDK, call `SentryClient.create(options)` as early as possible in the
entry modules in the main process as well as all renderer processes or further
sub processees you spawn. This will initialize the SDK and hook into the
environment. Note that you can turn off almost all side effects using the
respective options.

```javascript
import { SentryClient } from '@sentry/electron';

SentryClient.create({
  dsn: '__DSN__',
  // ...
});
```

To set context information or send manual events, use the provided methods on
`SentryClient`. Note that these functions will not perform any action before you
have called `SentryClient.install()`:

```javascript
// Set user information, as well as tags and further extras
SentryClient.setContext({
  extra: { battery: 0.7 },
  tags: { user_mode: 'admin' },
  user: { id: '4711' },
});

// Add a breadcrumb for future events
SentryClient.addBreadcrumb({
  message: 'My Breadcrumb',
  // ...
});

// Capture exceptions, messages or manual events
SentryClient.captureMessage('Hello, world!');
SentryClient.captureException(new Error('Good bye'));
SentryClient.captureEvent({
  message: 'Manual',
  stacktrace: [
    // ...
  ],
});
```

## Advanced Usage

If you don't want to use a global static instance of Sentry, you can create one
yourself:

```javascript
import { ElectronFrontend } from '@sentry/electron';

const client = new ElectronFrontend({
  dsn: '__DSN__',
  // ...
});

client.install();
// ...
```

Note that `install()` returns a `Promise` that resolves when the installation
has finished. It is not necessary to wait for the installation before adding
breadcrumbs, defining context or sending events. However, the return value
indicates whether the installation was successful and the environment could be
instrumented:

```javascript
import { ElectronFrontend } from '@sentry/electron';

const client = new ElectronFrontend({
  dsn: '__DSN__',
  // ...
});

const success = await client.install();
if (success) {
  // Will catch global exceptions, record breadcrumbs for DOM events, etc...
} else {
  // Limited instrumentation, but sending events will still work
}
```
