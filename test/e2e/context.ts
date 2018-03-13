import { ChildProcess, spawn } from 'child_process';
import { join } from 'path';
import pTree = require('process-tree');
import tmpdir = require('temporary-directory');
import { promisify } from 'util';
import { ProcessStatus } from './process';
import { TestServer } from './server';

const processTree = promisify(pTree);

/** A temporary directory handle. */
interface TempDirectory {
  /** Absolute path to the directory. */
  path: string;
  /** A function that will remove the directory when invoked. */
  cleanup(): void;
}

/** Creates a temporary directory with a cleanup function. */
async function getTempDir(): Promise<TempDirectory> {
  return new Promise<TempDirectory>((resolve, reject) => {
    tmpdir((err, dir, cleanup) => {
      if (err) {
        reject(err);
      } else {
        resolve({ cleanup, path: dir });
      }
    });
  });
}

/** A class to start and stop Electron apps for E2E tests. */
export class TestContext {
  /** Can check if the main process is running and kill it */
  public mainProcess?: ProcessStatus;
  /** Temporary directory that hosts the app's User Data. */
  private tempDir?: TempDirectory;
  /** Platform-independent path to the electron executable. */
  private readonly electronPath: string = require('electron') as any;

  /**
   * Creates an instance of TestContext.
   * Pass `undefined` to `testServer` to disable the test server.
   *
   * @param appPath Path to the application to run
   * @param testServer A test server instance.
   */
  public constructor(
    private readonly appPath: string = join(__dirname, 'test-app'),
    public testServer: TestServer = new TestServer(),
  ) {}

  /** Starts the app. */
  public async start(fixture?: string): Promise<void> {
    // Start the test server if required
    if (this.testServer) {
      this.testServer.start();
    }

    // Only setup the tempDir if this the first start of the context
    // Subsequent starts will use the same path
    if (!this.tempDir) {
      // Get a temp directory for this app to use as userData
      this.tempDir = await getTempDir();
    }

    const env: { [key: string]: string } = {
      DSN:
        'http://37f8a2ee37c0409d8970bc7559c7c7e4:4cfde0ca506c4ea39b4e25b61a1ff1c3@localhost:8000/277345',
      E2E_USERDATA_DIRECTORY: this.tempDir.path,
    };

    if (fixture) {
      env.E2E_TEST_FIXTURE = fixture;
    }

    const childProcess = spawn(this.electronPath, [this.appPath], { env });

    this.mainProcess = new ProcessStatus(childProcess.pid);
  }

  /** Stops the app and cleans up. */
  public async stop(clearData: boolean = true): Promise<void> {
    if (!this.mainProcess) {
      throw new Error('Invariant violation: Call .start() first');
    }

    await this.mainProcess.kill();

    if (this.tempDir && clearData) {
      this.tempDir.cleanup();
    }

    if (this.testServer) {
      await this.testServer.stop();
    }
  }

  /**
   * Promise only returns when the supplied method returns 'true'.
   *
   * @param method Method to poll.
   * @param timeout Time in ms to throw timeout.
   * @returns
   */
  public async waitForTrue(
    method: () => boolean | Promise<boolean>,
    timeout: number = 5000,
  ): Promise<void> {
    if (!this.mainProcess) {
      throw new Error('Invariant violation: Call .start() first');
    }

    const isPromise = method() instanceof Promise;

    let remaining = timeout;
    while (isPromise ? !await method() : !method()) {
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      remaining -= 100;
      if (remaining < 0) {
        throw new Error('Timed out');
      }
    }
  }
}
