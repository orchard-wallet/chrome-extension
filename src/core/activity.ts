export type ActivitySeverity = "info" | "success" | "warning" | "danger";

export type ActivityType =
  | "wallet_created"
  | "wallet_reset"
  | "transfer_preview_accepted"
  | "transaction_signed"
  | "transaction_broadcasted"
  | "walletconnect_connected"
  | "walletconnect_disconnected"
  | "walletconnect_rejected"
  | "signing_failed"
  | "network_enabled"
  | "security_backup_reminder";

export type ActivityCategory = "wallet" | "send" | "receive" | "swap" | "sign" | "settings" | "dapp" | "security";
export type ActivityStatus = "pending" | "completed" | "approved" | "reminder" | "failed";

export interface ActivityAmount {
  value: string;
  symbol: string;
  direction?: "in" | "out";
}

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  category: ActivityCategory;
  status: ActivityStatus;
  title: string;
  detail: string;
  severity: ActivitySeverity;
  createdAt: string;
  amount?: ActivityAmount;
  networkName?: string;
  txHash?: string;
}

export type ActivityEventInput = Omit<ActivityEvent, "id" | "createdAt" | "category" | "status"> &
  Partial<Pick<ActivityEvent, "category" | "status">>;

export const ACTIVITY_FILTERS: Array<{ id: "all" | ActivityCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "wallet", label: "Wallet" },
  { id: "send", label: "Send" },
  { id: "receive", label: "Receive" },
  { id: "swap", label: "Swap" },
  { id: "sign", label: "Sign" },
  { id: "settings", label: "Settings" }
];

const FALLBACK_CREATED_AT = new Date(0).toISOString();

function inferredCategory(type: ActivityType): ActivityCategory {
  switch (type) {
    case "wallet_created":
    case "wallet_reset":
      return "wallet";
    case "transfer_preview_accepted":
    case "transaction_broadcasted":
      return "send";
    case "transaction_signed":
    case "signing_failed":
      return "sign";
    case "walletconnect_connected":
    case "walletconnect_disconnected":
    case "walletconnect_rejected":
      return "dapp";
    case "security_backup_reminder":
      return "security";
    case "network_enabled":
      return "settings";
  }
}

function inferredStatus(type: ActivityType): ActivityStatus {
  switch (type) {
    case "transfer_preview_accepted":
    case "transaction_signed":
    case "walletconnect_connected":
      return "approved";
    case "signing_failed":
    case "walletconnect_rejected":
      return "failed";
    case "security_backup_reminder":
      return "reminder";
    default:
      return "completed";
  }
}

function isActivityType(value: unknown): value is ActivityType {
  return typeof value === "string" && [
    "wallet_created",
    "wallet_reset",
    "transfer_preview_accepted",
    "transaction_signed",
    "transaction_broadcasted",
    "walletconnect_connected",
    "walletconnect_disconnected",
    "walletconnect_rejected",
    "signing_failed",
    "network_enabled",
    "security_backup_reminder"
  ].includes(value);
}

function isCategory(value: unknown): value is ActivityCategory {
  return typeof value === "string" && ["wallet", "send", "receive", "swap", "sign", "settings", "dapp", "security"].includes(value);
}

function isStatus(value: unknown): value is ActivityStatus {
  return typeof value === "string" && ["pending", "completed", "approved", "reminder", "failed"].includes(value);
}

function isSeverity(value: unknown): value is ActivitySeverity {
  return typeof value === "string" && ["info", "success", "warning", "danger"].includes(value);
}

export function createActivityEvent(input: ActivityEventInput): ActivityEvent {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    category: input.category ?? inferredCategory(input.type),
    status: input.status ?? inferredStatus(input.type)
  };
}

export function normalizeActivityEvent(value: unknown): ActivityEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const event = value as Partial<ActivityEvent>;

  if (!isActivityType(event.type) || typeof event.title !== "string" || typeof event.detail !== "string") {
    return null;
  }

  return {
    id: typeof event.id === "string" && event.id ? event.id : crypto.randomUUID(),
    type: event.type,
    category: isCategory(event.category) ? event.category : inferredCategory(event.type),
    status: isStatus(event.status) ? event.status : inferredStatus(event.type),
    title: event.title,
    detail: event.detail,
    severity: isSeverity(event.severity) ? event.severity : "info",
    createdAt: typeof event.createdAt === "string" && event.createdAt ? event.createdAt : FALLBACK_CREATED_AT,
    amount: event.amount,
    networkName: typeof event.networkName === "string" ? event.networkName : undefined,
    txHash: typeof event.txHash === "string" ? event.txHash : undefined
  };
}

export function searchActivityEvents(events: ActivityEvent[], category: "all" | ActivityCategory, query: string): ActivityEvent[] {
  const normalizedQuery = query.trim().toLowerCase();

  return events.filter((event) => {
    if (category !== "all" && event.category !== category) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      event.title,
      event.detail,
      event.type,
      event.category,
      event.status,
      event.networkName ?? "",
      event.amount?.value ?? "",
      event.amount?.symbol ?? "",
      event.txHash ?? ""
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

export function activityTotals(events: ActivityEvent[]) {
  return {
    total: events.length,
    pending: events.filter((event) => event.status === "pending").length,
    successful: events.filter((event) => event.status === "completed" || event.status === "approved").length
  };
}
