import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = { title: 'Sign up' };

export default function RegisterPage() {
  return (
    <div className="container-page py-16">
      <AuthForm mode="register" />
    </div>
  );
}
