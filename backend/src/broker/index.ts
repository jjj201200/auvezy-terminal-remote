/**
 * broker 模块入口（0.7.0）
 *
 * 详见：
 *  - docs/plans/path-routing/design.md
 *  - docs/plans/path-routing/adrs/001-broker-worker-split.md
 */

export {
  readBrokerState,
  writeBrokerState,
  clearBrokerState,
  isBrokerAlive,
  defaultBrokerStatePath,
  type BrokerState,
} from './broker-state.js';

export {
  createBrokerApp,
  startBrokerServer,
  DEFAULT_BROKER_PORT,
  DEFAULT_BROKER_HOST,
  type BrokerAppOptions,
  type BrokerServerOptions,
  type BrokerServerHandle,
} from './broker-server.js';

export {
  ensureBroker,
  defaultBrokerLockDir,
  type EnsureBrokerOptions,
  type EnsureBrokerResult,
} from './ensure-broker.js';

export {
  getPublicUrl,
  getInstanceFromHeaders,
  isFromBroker,
  HEADER_FORWARDED_INSTANCE,
  HEADER_FORWARDED_PATH,
  HEADER_FORWARDED_HOST,
  HEADER_FORWARDED_PROTO,
  HEADER_FORWARDED_FOR,
} from './forwarded-headers.js';
