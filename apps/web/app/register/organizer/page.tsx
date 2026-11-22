import type { Metadata } from 'next';
import { OrganizerRegisterForm } from '@/components/organizer/register-form';

export const metadata: Metadata = { title: 'Register as an organizer' };

export default function RegisterOrganizerPage() {
  return (
    <div className="container-page py-16">
      <OrganizerRegisterForm />
    </div>
  );
}
