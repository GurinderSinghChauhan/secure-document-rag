import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-right"
  | "building"
  | "check"
  | "dashboard"
  | "documents"
  | "lock"
  | "members"
  | "message"
  | "platform"
  | "queue"
  | "sign-out";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

const paths: Record<IconName, ReactNode> = {
  "arrow-right": <path d="M5 12h14m-5-5 5 5-5 5" />,
  building: (
    <>
      <path d="M4 21h16M6 21V7l6-4 6 4v14" />
      <path d="M9 10h1m4 0h1m-6 4h1m4 0h1m-4 7v-4h2v4" />
    </>
  ),
  check: <path d="m7 12 3 3 7-7" />,
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  documents: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5M10 12h5m-5 4h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 4.5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 3.5 4.8" />
    </>
  ),
  message: (
    <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
  ),
  platform: (
    <>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  queue: (
    <>
      <path d="M4 7h16M4 12h11M4 17h7" />
      <circle cx="19" cy="17" r="2" />
    </>
  ),
  "sign-out": (
    <>
      <path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" />
    </>
  ),
};

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
