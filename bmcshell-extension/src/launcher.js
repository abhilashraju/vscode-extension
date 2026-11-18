// @ts-check
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DOCKER_HOME_VOLUME = 'bmcshellhome';

/**
 * @typedef {Object} Settings
 * @property {string} mode
 * @property {string} jarPath
 * @property {string} [bundledJarPath] jar shipped with the extension, used when jarPath is empty
 * @property {string} javaPath
 * @property {string[]} jvmArgs
 * @property {number} port
 * @property {string} workingDirectory
 * @property {string} dockerImage
 */

/**
 * @param {number} port
 * @returns {number}
 */
function validatePort(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('bmcshellProfile.port must be an integer between 1 and 65535.');
    }
    return port;
}

/**
 * Resolve (and create) the working directory
 * @param {string} configured
 * @returns {string}
 */
function resolveWorkingDirectory(configured) {
    const dir = configured && configured.trim()
        ? configured.trim()
        : path.join(os.homedir(), '.bmcshell');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Build terminal options that launch bmcshell from the jar.
 * Arguments are passed as an array, never through a shell string.
 * @param {Settings} s
 * @returns {{name: string, shellPath: string, shellArgs: string[], cwd: string}}
 */
function buildJarLaunch(s) {
    const jarPath = s.jarPath || s.bundledJarPath;
    if (!jarPath) {
        throw new Error('bmcshellProfile.jarPath is not set. Run "bmcshell Profile: Select Jar File".');
    }
    if (!fs.existsSync(jarPath) || !fs.statSync(jarPath).isFile()) {
        throw new Error(`bmcshell jar not found: ${jarPath}`);
    }
    const port = validatePort(s.port);
    return {
        name: 'bmcshell',
        shellPath: s.javaPath || 'java',
        shellArgs: [...s.jvmArgs, `-Dserver.port=${port}`, '-jar', jarPath],
        cwd: resolveWorkingDirectory(s.workingDirectory)
    };
}

/**
 * Build terminal options that launch bmcshell in Docker (mirrors bmcshell.sh).
 * @param {Settings} s
 * @returns {{name: string, shellPath: string, shellArgs: string[], cwd: string}}
 */
function buildDockerLaunch(s) {
    if (!s.dockerImage || /\s/.test(s.dockerImage)) {
        throw new Error('bmcshellProfile.dockerImage is empty or invalid.');
    }
    const port = validatePort(s.port);
    const home = os.homedir();
    return {
        name: 'bmcshell (docker)',
        shellPath: 'docker',
        shellArgs: [
            'run', '-it', '--rm',
            '-p', `${port}:${port}`,
            '-e', `PORT1=${port}`,
            '-v', `${home}:${home}`,
            '--network', 'host',
            '--add-host=host.docker.internal:host-gateway',
            '-v', `${DOCKER_HOME_VOLUME}:/bmcshellhome`,
            '-v', `${path.join(home, '.ssh')}/:/home/root/.ssh/`,
            s.dockerImage
        ],
        cwd: home
    };
}

/**
 * @param {Settings} s
 * @returns {{name: string, shellPath: string, shellArgs: string[], cwd: string}}
 */
function buildLaunch(s) {
    return s.mode === 'docker' ? buildDockerLaunch(s) : buildJarLaunch(s);
}

module.exports = { buildLaunch, buildJarLaunch, buildDockerLaunch, validatePort };
