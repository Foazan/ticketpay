import { ButtonLink, EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="container-page py-16">
      <EmptyState title="Page not found" body="The page or event you are looking for does not exist or is no longer published." action={<ButtonLink href="/events">Explore events</ButtonLink>} />
    </div>
  );
}
