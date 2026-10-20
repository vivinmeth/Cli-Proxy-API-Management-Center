import { useAuthStore } from '@/stores';
import { DEPLOY_ENV_LABEL, resolveDeployEnv } from './brand';
import styles from './EnvPill.module.scss';

interface EnvPillProps {
  /** Defaults to the API base of the current connection. */
  apiBase?: string;
  className?: string;
}

export function EnvPill({ apiBase, className }: EnvPillProps) {
  const storedBase = useAuthStore((state) => state.apiBase);
  const env = resolveDeployEnv(apiBase ?? storedBase);
  if (!env) return null;
  return (
    <span className={`${styles.pill} ${styles[env]} ${className ?? ''}`} data-env={env}>
      {DEPLOY_ENV_LABEL[env]}
    </span>
  );
}
