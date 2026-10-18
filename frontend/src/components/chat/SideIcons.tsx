import React from 'react';

/* Чат бетінің сол панеліне арналған белгішелер — тек сызықтық (stroke), толтырусыз */

type SideIcon = React.FC<{ size?: number }>;

const Base: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 18 }) => (
  <svg
    className="csi"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/* Чаттар қойындысы */
export const ChatsTabIcon: SideIcon = ({ size }) => (
  <Base size={size}>
    <path d="M12 4.5c4.4 0 8 3 8 6.8s-3.6 6.8-8 6.8c-1 0-2-.15-2.9-.45L5 19.5l1.2-3.4C4.8 14.9 4 13.2 4 11.3 4 7.5 7.6 4.5 12 4.5Z" />
    <path d="M8.6 11.3h.01M12 11.3h.01M15.4 11.3h.01" strokeWidth="2.4" />
  </Base>
);

/* Дос қосу қойындысы */
export const AddFriendTabIcon: SideIcon = ({ size }) => (
  <Base size={size}>
    <circle cx="10" cy="8" r="3.6" />
    <path d="M3.5 19.5c0-3.3 2.9-5.6 6.5-5.6 1.3 0 2.5.3 3.5.8" />
    <path d="M18 14v6M15 17h6" />
  </Base>
);

/* Сұраулар қойындысы: конверт + келген нүкте */
export const RequestsTabIcon: SideIcon = ({ size }) => (
  <Base size={size}>
    <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
    <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
  </Base>
);

/* Сақталған хабарлар */
export const SavedIcon: SideIcon = ({ size }) => (
  <Base size={size}>
    <path d="M7.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v15.2l-6-3.9-6 3.9V5a1.5 1.5 0 0 1 1.5-1.5Z" />
  </Base>
);

/* Жаңа топ: топ адамдары + плюс */
export const NewGroupIcon: SideIcon = ({ size }) => (
  <Base size={size}>
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M3 19.5c.6-3 3-4.9 6-4.9 1.5 0 2.9.5 3.9 1.3" />
    <path d="M15 5.4a3.3 3.3 0 0 1 1.6 5.9" />
    <path d="M18.5 14.5v6M15.5 17.5h6" />
  </Base>
);

/* Панельді жию/ашу: шеті + бағыт жебесі (жиылғанда жебе бұрылады) */
export const SideToggleIcon: SideIcon = ({ size }) => (
  <Base size={size}>
    <rect x="3.5" y="4" width="17" height="16" rx="3" />
    <path d="M9 4v16" />
    <path className="csi-arrow" d="m15.5 9.5-2.5 2.5 2.5 2.5" />
  </Base>
);
