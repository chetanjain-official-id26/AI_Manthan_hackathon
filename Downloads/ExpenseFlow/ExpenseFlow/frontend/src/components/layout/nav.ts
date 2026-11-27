import {
  BarChart3,
  ClipboardCheck,
  FileText,
  House,
  Inbox,
  ScrollText,
  Settings2,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Me } from '@/api/types';
import { hasRole, isApprover } from '@/features/auth/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  visible: (me: Me) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/home', label: 'Home', icon: House, testId: 'nav-home', visible: () => true },
  { to: '/claims', label: 'My claims', icon: FileText, testId: 'nav-claims', visible: () => true },
  { to: '/inbox', label: 'Inbox', icon: Inbox, testId: 'nav-inbox', visible: (me) => isApprover(me) },
  {
    to: '/auditor',
    label: 'Auditor queue',
    icon: ClipboardCheck,
    testId: 'nav-auditor',
    visible: (me) => hasRole(me, 'AUDITOR', 'FINANCE_HEAD'),
  },
  { to: '/payouts', label: 'Payouts', icon: Wallet, testId: 'nav-payouts', visible: (me) => hasRole(me, 'FINANCE_HEAD') },
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: BarChart3,
    testId: 'nav-dashboard',
    visible: (me) => hasRole(me, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD'),
  },
  {
    to: '/audit',
    label: 'Audit trail',
    icon: ScrollText,
    testId: 'nav-audit',
    visible: (me) => hasRole(me, 'AUDITOR', 'FINANCE_HEAD'),
  },
  {
    to: '/admin/policies',
    label: 'Policy rules',
    icon: ShieldCheck,
    testId: 'nav-policies',
    visible: (me) => hasRole(me, 'AUDITOR', 'FINANCE_HEAD'),
  },
  {
    to: '/settings/delegation',
    label: 'Delegation',
    icon: Settings2,
    testId: 'nav-delegation',
    visible: (me) => hasRole(me, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD'),
  },
];
