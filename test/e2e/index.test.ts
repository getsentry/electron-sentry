import { expect, should, use } from 'chai';
import chaiAsPromised = require('chai-as-promised');
import { join } from 'path';

import { TestContext } from './context';
import { downloadElectron } from './download';
import { TestServer } from './server';
import { getLastFrame, getTests } from './utils';

const SENTRY_KEY = '37f8a2ee37c0409d8970bc7559c7c7e4';

should();
use(chaiAsPromised);

const tests = getTests(
  '1.8.8',
  '2.0.18',
  '3.1.13',
  '4.2.12',
  '5.0.13',
  '6.1.12',
  '7.3.3',
  '8.5.5',
  '9.3.5',
  '10.1.6',
  '11.0.4',
);

describe('E2E Tests', () => {
  let testServer: TestServer;

  before(() => {
    testServer = new TestServer();
    testServer.start();
  });

  after(async () => {
    await testServer.stop();
  });

  tests.forEach(([version, arch]) => {
    const majorVersion = Math.floor(parseFloat(version));
    if (majorVersion < 3 && process.platform === 'linux') {
      // We skip tests on linux for electron version < 3
      return;
    }

    if (majorVersion === 4 && process.platform === 'win32') {
      // We skip electron version 4 on Windows as it wont pass on Travis
      return;
    }

    describe(`Electron ${version} ${arch}`, () => {
      let context: TestContext;

      beforeEach(async () => {
        testServer.clearEvents();

        const electronPath = await downloadElectron(version, arch);
        context = new TestContext(electronPath);
      });

      afterEach(async () => {
        if (context.isStarted()) {
          await context.stop();
        }
      });

      it('JavaScript exception in renderer process', async () => {
        await context.start('sentry-basic', 'javascript-renderer');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript-renderer.js');

        expect(event.dump_file).to.be.false;
        expect(event.data.platform).to.equal('javascript');
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('JavaScript unhandledrejection in renderer process', async () => {
        await context.start('sentry-basic', 'javascript-unhandledrejection');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript-unhandledrejection.js');
        expect(event.dump_file).to.be.false;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(event.data.sdk?.name).to.equal('sentry.javascript.electron');
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('JavaScript exception in main process', async () => {
        await context.start('sentry-basic', 'javascript-main');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript-main.js');
        expect(event.dump_file).to.be.false;
        expect(event.data.platform).to.equal('node');
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(event.data.sdk?.name).to.equal('sentry.javascript.electron');
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('JavaScript exception in main process with space in path', async () => {
        await context.start('sentry-basic', 'javascript main with spaces');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript main with spaces.js');
        expect(event.dump_file).to.be.false;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('JavaScript exception in main process with parentheses in path', async () => {
        await context.start('sentry-basic', 'javascript main with (parens)');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript main with (parens).js');
        expect(event.dump_file).to.be.false;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      // tslint:disable-next-line
      it('onFatalError can be overridden', async function() {
        // For some unknown reason this test fails on windows
        if (process.platform === 'win32') {
          this.skip();
          return;
        }

        await context.start('sentry-onfatal-exit', 'javascript-main');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript-main.js');
        expect(event.dump_file).to.be.false;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);

        await context.waitForTrue(
          async () => (context.mainProcess ? !(await context.mainProcess.isRunning()) : false),
          'Timeout: Waiting for app to die',
        );
      });

      // tslint:disable-next-line
      it('Native crash in renderer process', async () => {
        await context.start('sentry-basic', 'native-renderer');
        // It can take rather a long time to get the event on Mac
        await context.waitForEvents(testServer, 1, 20000);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];

        expect(testServer.events.length).to.equal(1);
        expect(event.dump_file).to.be.true;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('JavaScript exception in main process with user data', async () => {
        await context.start('sentry-scope-user-data', 'javascript-main');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const user = event.data.user || {};

        expect(user.id).to.equal('johndoe');
      });

      // tslint:disable-next-line
      it('Native crash in main process', async () => {
        await context.start('sentry-basic', 'native-main');

        // wait for the main process to die
        await context.waitForTrue(
          async () => (context.mainProcess ? !(await context.mainProcess.isRunning()) : false),
          'Timeout: Waiting for app to die',
        );

        // We have to restart the app to send native crashes from the main process
        await context.stop(false);
        await context.start('sentry-basic');

        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];

        expect(testServer.events.length).to.equal(1);
        expect(event.dump_file).to.be.true;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('Captures breadcrumbs in renderer process', async () => {
        await context.start('sentry-basic', 'breadcrumbs-in-renderer');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        let breadcrumbs = event.data.breadcrumbs || [];

        breadcrumbs = breadcrumbs.filter(crumb => crumb.message === 'Something insightful!');

        expect(testServer.events.length).to.equal(1);
        expect(event.dump_file).to.be.false;
        console.log(breadcrumbs);
        expect(breadcrumbs.length, 'filtered breadcrumbs').to.equal(1);
      });

      it('Captures Scope data correctly from renderer', async () => {
        await context.start('sentry-basic', 'scope-data-renderer');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        // console.log(JSON.stringify(event.data.breadcrumbs));
        expect(event.data.extra?.a).to.equal(2);
        expect(event.data.user?.id).to.equal('1');
        expect(event.data.tags?.a).to.equal('b');
        expect(event.data.contexts?.server).to.include({ id: '2' });
        expect(event.data.fingerprint).to.include('abcd');
      });

      it('Captures Scope data correctly from main', async () => {
        await context.start('sentry-basic', 'scope-data-main');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];

        expect(event.data.extra?.a).to.equal(2);
        expect(event.data.user?.id).to.equal('2');
        expect(event.data.tags?.a).to.equal('b');
        expect(event.data.contexts?.server).to.include({ id: '2' });
        expect(event.data.fingerprint).to.include('abcd');
      });

      it('Loaded via preload script with nodeIntegration disabled', async function() {
        if (majorVersion < 8) {
          this.skip();
          return;
        }

        const electronPath = await downloadElectron(version, arch);
        context = new TestContext(electronPath, join(__dirname, 'preload-app'));
        await context.start();
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];

        expect(testServer.events.length).to.equal(1);
        expect(event.dump_file).to.be.false;
      });

      it('Custom release string for JavaScript error', async () => {
        await context.start('sentry-custom-release', 'javascript-renderer');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];
        const lastFrame = getLastFrame(event.data);

        expect(event.data.release).to.equal('some-custom-release');

        expect(testServer.events.length).to.equal(1);
        expect(lastFrame.filename).to.equal('app:///fixtures/javascript-renderer.js');

        expect(event.dump_file).to.be.false;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('Custom release string for minidump', async () => {
        await context.start('sentry-custom-release', 'native-renderer');
        // It can take rather a long time to get the event on Mac
        await context.waitForEvents(testServer, 1, 20000);
        const event = testServer.events[0];
        const breadcrumbs = event.data.breadcrumbs || [];

        expect(event.data.release).to.equal('some-custom-release');

        expect(testServer.events.length).to.equal(1);
        expect(event.dump_file).to.be.true;
        expect(event.sentry_key).to.equal(SENTRY_KEY);
        expect(breadcrumbs.length).to.greaterThan(4);
      });

      it('Custom named renderer process', async () => {
        await context.start('sentry-custom-renderer-name', 'javascript-renderer');
        await context.waitForEvents(testServer, 1);
        const event = testServer.events[0];

        expect(testServer.events.length).to.equal(1);
        expect(event.data.contexts && (event.data.contexts.electron as any).crashed_process).to.equal('renderer');
      });
    });
  });
});
