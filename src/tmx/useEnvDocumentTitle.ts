import { useEffect } from 'react';
import { useAuthStore } from '@/stores';
import { BRAND_NAME, DEPLOY_ENV_LABEL, resolveDeployEnv } from './brand';

/** Prefixes the tab title with the environment ("STAGING · TokenMAXX Proxy") outside prod. */
export function useEnvDocumentTitle() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const env = resolveDeployEnv(apiBase);
  useEffect(() => {
    document.title =
      env && env !== 'prod' ? `${DEPLOY_ENV_LABEL[env]} · ${BRAND_NAME}` : BRAND_NAME;
  }, [env]);
}
