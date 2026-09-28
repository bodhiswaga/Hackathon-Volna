import { ConfirmHost, Toasts } from './components/ui';
import { useHash } from './lib/router';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';

export function App() {
  const hash = useHash();
  const match = hash.match(/^#\/p\/([^/]+)/);
  return (
    <>
      {match ? <ProjectPage key={match[1]} id={decodeURIComponent(match[1])} /> : <ProjectsPage />}
      <Toasts />
      <ConfirmHost />
    </>
  );
}
