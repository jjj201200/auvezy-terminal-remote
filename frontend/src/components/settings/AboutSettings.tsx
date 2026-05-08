/**
 * AboutSettings
 *
 * 关于面板：版本号、简介、特性、链接、许可。
 * 纯静态信息（版本号由 vite define 注入），无需后端字段。
 */

import { useState, type JSX } from 'react';
import { useT } from '../../i18n/i18n-context.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import s from './AboutSettings.module.scss';

const REPO_GITHUB_URL = 'https://github.com/jjj201200/auvezy-terminal-remote';
const REPO_GITEE_URL = 'https://gitee.com/drowsyflesh/auvezy-terminal-remote';
const ISSUES_GITHUB_URL = 'https://github.com/jjj201200/auvezy-terminal-remote/issues';
const ISSUES_GITEE_URL = 'https://gitee.com/drowsyflesh/auvezy-terminal-remote/issues';
const NPM_URL = 'https://www.npmjs.com/package/auvezy-terminal-remote';

export function AboutSettings(): JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopyVersion = async (): Promise<void> => {
    if (await copyToClipboard(__APP_VERSION__)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={s.root}>
      <header className={s.hero}>
        <div className={s.brand}>
          <span className={s.brandName}>auvezy-terminal-remote</span>
          <button
            type="button"
            className={s.versionPill}
            onClick={() => void handleCopyVersion()}
            title={t('about.versionTooltip')}
            aria-label={`${t('about.versionLabel')} ${__APP_VERSION__}`}
          >
            v{__APP_VERSION__}
            {copied && <span className={s.copied}>✓</span>}
          </button>
        </div>
        <p className={s.tagline}>{t('about.tagline')}</p>
      </header>

      <section className={s.section}>
        <h3 className={s.title}>{t('about.descTitle')}</h3>
        <p className={s.body}>{t('about.descBody')}</p>
      </section>

      <section className={s.section}>
        <h3 className={s.title}>{t('about.featuresTitle')}</h3>
        <ul className={s.list}>
          <li>{t('about.featurePty')}</li>
          <li>{t('about.featureMultiInstance')}</li>
          <li>{t('about.featureAuth')}</li>
          <li>{t('about.featurePush')}</li>
          <li>{t('about.featureMobile')}</li>
        </ul>
      </section>

      <section className={s.section}>
        <h3 className={s.title}>{t('about.notesTitle')}</h3>
        <ul className={s.list}>
          <li>{t('about.notePersistent')}</li>
          <li>{t('about.noteLanOnly')}</li>
          <li>{t('about.noteMasterResize')}</li>
          <li>{t('about.noteVirtualNic')}</li>
        </ul>
      </section>

      <section className={s.section}>
        <h3 className={s.title}>{t('about.linksTitle')}</h3>
        <ul className={s.linkList}>
          <li>
            <a href={REPO_GITHUB_URL} target="_blank" rel="noreferrer noopener">
              {t('about.repoGithubLabel')}
            </a>
          </li>
          <li>
            <a href={REPO_GITEE_URL} target="_blank" rel="noreferrer noopener">
              {t('about.repoGiteeLabel')}
            </a>
          </li>
          <li>
            <a href={ISSUES_GITHUB_URL} target="_blank" rel="noreferrer noopener">
              {t('about.issuesGithubLabel')}
            </a>
          </li>
          <li>
            <a href={ISSUES_GITEE_URL} target="_blank" rel="noreferrer noopener">
              {t('about.issuesGiteeLabel')}
            </a>
          </li>
          <li>
            <a href={NPM_URL} target="_blank" rel="noreferrer noopener">
              {t('about.npmLabel')}
            </a>
          </li>
        </ul>
      </section>

      <section className={s.section}>
        <h3 className={s.title}>{t('about.licenseTitle')}</h3>
        <p className={s.body}>{t('about.licenseBody')}</p>
      </section>
    </div>
  );
}
