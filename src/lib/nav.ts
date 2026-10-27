import type { LucideIcon } from "lucide-react";
import {
  Bed,
  Building2,
  BusFront,
  CalendarRange,
  ChartNoAxesColumn,
  ClipboardCheck,
  Gauge,
  Network,
  Plug,
  Settings,
  Soup,
  UserCheck,
  Users,
  Warehouse,
} from "lucide-react";
import type { Action, Subject } from "@/lib/authz/types";

/* ===========================================================================
   Navigation.

   Each entry declares the permission that makes it meaningful, so the sidebar
   and the command palette are both derived from one list rather than drifting
   apart. A role that cannot read Beds does not see Accommodation — not because
   the link is disabled, but because it was never relevant to their job.
   ========================================================================= */

export interface NavItem {
  key: string;
  /** Path relative to /{orgSlug}. */
  href: string;
  icon: LucideIcon;
  /** i18n key under `nav`. */
  labelKey: string;
  permission: { action: Action; subject: Subject };
  /** Set for modules that are navigable but not yet built. */
  stubPhase?: number;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    labelKey: "",
    items: [
      {
        key: "dashboard",
        href: "/dashboard",
        icon: Gauge,
        labelKey: "nav.dashboard",
        // Everyone who can read anything gets a dashboard; the widgets inside
        // are what differ by role.
        permission: { action: "read", subject: "Site" },
      },
    ],
  },
  {
    key: "people",
    labelKey: "nav.groupPeople",
    items: [
      {
        key: "org-chart",
        href: "/org-chart",
        icon: Network,
        labelKey: "nav.orgChart",
        permission: { action: "read", subject: "OrgUnit" },
      },
      {
        key: "workforce",
        href: "/workforce",
        icon: Users,
        labelKey: "nav.workforce",
        permission: { action: "read", subject: "Employee" },
      },
    ],
  },
  {
    key: "operations",
    labelKey: "nav.groupOperations",
    items: [
      {
        key: "rosters",
        href: "/rosters",
        icon: CalendarRange,
        labelKey: "nav.rosters",
        permission: { action: "read", subject: "RosterPeriod" },
      },
      {
        key: "attendance",
        href: "/attendance",
        icon: UserCheck,
        labelKey: "nav.attendance",
        permission: { action: "read", subject: "Attendance" },
        stubPhase: 6,
      },
      {
        key: "camps",
        href: "/camps",
        icon: Warehouse,
        labelKey: "nav.camps",
        permission: { action: "read", subject: "Camp" },
      },
      {
        key: "accommodation",
        href: "/accommodation",
        icon: Bed,
        labelKey: "nav.accommodation",
        permission: { action: "read", subject: "AccommodationBooking" },
      },
      {
        key: "transport",
        href: "/transport",
        icon: BusFront,
        labelKey: "nav.transport",
        permission: { action: "read", subject: "TransportTrip" },
        stubPhase: 4,
      },
      {
        key: "visitors",
        href: "/visitors",
        icon: Building2,
        labelKey: "nav.visitors",
        permission: { action: "read", subject: "Visit" },
        stubPhase: 5,
      },
      {
        key: "meals",
        href: "/meals",
        icon: Soup,
        labelKey: "nav.meals",
        permission: { action: "read", subject: "MealForecast" },
        stubPhase: 6,
      },
    ],
  },
  {
    key: "admin",
    labelKey: "nav.groupAdmin",
    items: [
      {
        key: "approvals",
        href: "/approvals",
        icon: ClipboardCheck,
        labelKey: "nav.approvals",
        permission: { action: "approve", subject: "LeaveRequest" },
      },
      {
        key: "reports",
        href: "/reports",
        icon: ChartNoAxesColumn,
        labelKey: "nav.reports",
        permission: { action: "read", subject: "Report" },
        stubPhase: 6,
      },
      {
        key: "integrations",
        href: "/integrations",
        icon: Plug,
        labelKey: "nav.integrations",
        permission: { action: "manage", subject: "Setting" },
        stubPhase: 6,
      },
      {
        key: "settings",
        href: "/settings/roles",
        icon: Settings,
        labelKey: "nav.settings",
        permission: { action: "read", subject: "Role" },
      },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
