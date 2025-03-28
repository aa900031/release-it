import util from 'node:util';
import { cosmiconfigSync } from 'cosmiconfig';
import parseToml from '@iarna/toml/parse-string.js';
import { isCI } from 'ci-info';
import defaultsDeep from '@nodeutils/defaults-deep';
import { isObjectStrict } from '@phun-ky/typeof';
import merge from 'lodash.merge';
import get from 'lodash.get';
import { e, getSystemInfo, readJSON } from './util.js';

const debug = util.debug('release-it:config');
const defaultConfig = readJSON(new URL('../config/release-it.json', import.meta.url));

const searchPlaces = [
  'package.json',
  '.release-it.json',
  '.release-it.js',
  '.release-it.ts',
  '.release-it.cjs',
  '.release-it.yaml',
  '.release-it.yml',
  '.release-it.toml'
];

const loaders = {
  '.toml': (_, content) => parseToml(content)
};

const getLocalConfig = ({ file, dir = process.cwd() }) => {
  let localConfig = {};
  if (file === false) return localConfig;
  const explorer = cosmiconfigSync('release-it', {
    searchPlaces,
    loaders
  });
  const result = file ? explorer.load(file) : explorer.search(dir);
  if (result && typeof result.config === 'string') {
    throw new Error(`Invalid configuration file at ${result.filepath}`);
  }
  debug({ cosmiconfig: result });
  return result && isObjectStrict(result.config) ? result.config : localConfig;
};

const fetchConfigurationFromGitHub = async configuration => {
  const docs = 'https://github.com/release-it/release-it/blob/main/docs/configuration.md';

  const regex = /^github:([^/]+)\/([^#:]+)(?::([^#]+))?(?:#(.+))?$/;
  const match = configuration.match(regex);

  if (!match) {
    throw e(`Invalid Extended Configuration from GitHub: ${configuration}`, docs);
  }

  const [, owner, repo, file = '.release-it.json', tag] = match;
  const ref = tag ? `refs/tags/${tag}` : 'HEAD';
  const url = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw e(`Failed to fetch ${url}: ${response.statusText}`, docs);
  }

  return response.json();
};

const getRemoteConfiguration = async configuration => {
  return fetchConfigurationFromGitHub(configuration);
};

class Config {
  constructor(config = {}) {
    this.constructorConfig = config;
    this.localConfig = getLocalConfig({ file: config.config, dir: config.configDir });
    this.options = this.mergeOptions();
    this.options = this.expandPreReleaseShorthand(this.options);
    this.contextOptions = {};
    debug({ system: getSystemInfo() });
    debug(this.options);
  }

  expandPreReleaseShorthand(options) {
    const { increment, preRelease, preReleaseId, snapshot, preReleaseBase } = options;
    const isPreRelease = Boolean(preRelease) || Boolean(snapshot);
    const inc = snapshot ? 'prerelease' : increment;
    const preId = typeof preRelease === 'string' ? preRelease : typeof snapshot === 'string' ? snapshot : preReleaseId;
    options.version = {
      increment: inc,
      isPreRelease,
      preReleaseId: preId,
      preReleaseBase
    };
    if (typeof snapshot === 'string' && options.git) {
      // Pre set and hard code some options
      options.git.tagMatch = `0.0.0-${snapshot}.[0-9]*`;
      options.git.getLatestTagFromAllRefs = true;
      options.git.requireBranch = '!main';
      options.git.requireUpstream = false;
      options.npm.ignoreVersion = true;
    }
    return options;
  }

  mergeOptions() {
    return defaultsDeep(
      {},
      this.constructorConfig,
      {
        ci: isCI
      },
      this.localConfig,
      this.defaultConfig
    );
  }

  mergeRemoteOptions(remoteConfiguration) {
    return merge({}, this.options, remoteConfiguration);
  }
  getContext(path) {
    const context = merge({}, this.options, this.contextOptions);
    return path ? get(context, path) : context;
  }

  setContext(options) {
    debug(options);
    merge(this.contextOptions, options);
  }

  setCI(value = true) {
    this.options.ci = value;
  }

  get defaultConfig() {
    return defaultConfig;
  }

  get isDryRun() {
    return Boolean(this.options['dry-run']);
  }

  get isIncrement() {
    return this.options.increment !== false;
  }

  get isVerbose() {
    return Boolean(this.options.verbose);
  }

  get verbosityLevel() {
    return this.options.verbose;
  }

  get isDebug() {
    return debug.enabled;
  }

  get isCI() {
    return Boolean(this.options.ci) || this.isReleaseVersion || this.isChangelog;
  }

  get isPromptOnlyVersion() {
    return this.options['only-version'];
  }

  get isReleaseVersion() {
    return Boolean(this.options['release-version']);
  }

  get isChangelog() {
    return Boolean(this.options['changelog']);
  }
}

export { getRemoteConfiguration };

export default Config;
