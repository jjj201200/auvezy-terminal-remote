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
