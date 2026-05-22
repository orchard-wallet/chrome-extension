import type { WalletNetworkSetting } from "../core/networks";
import { emptyAssetStore, type AssetStore } from "../core/assets";
import { createAddressBookContact, normalizeAddressBookContact, type AddressBookContact, type AddressBookContactInput } from "../core/addressBook";
import type { RecipientResolution } from "../core/ens";
import { createActivityEvent, normalizeActivityEvent, type ActivityEvent, type ActivityEventInput } from "../core/activity";

export interface WalletRecord {
  name?: string;
  address: string;
  chainAccounts?: {
    ethereum: string;
    tron?: string;
    bitcoin?: string;
  };
  credentialId: string;
  derivationPath: string;
  keystoreJson: string;
  rpId: string;
  userId: string;
}

export interface WalletUiSettings {
  privacyMode: boolean;
  compactMode: boolean;
  defaultCurrency: "USD";
  startPage: "portal" | "send" | "receive";
  visibleWidgets: string[];
  widgetOrder: string[];
  collapsedWidgets: string[];
  defaultSendNetworkId: string | null;
  language: string;
}

export interface RecentRecipient {
  address: string;
  ensLabel?: string;
  lastUsedAt: string;
  networkId: string;
  networkName: string;
}

export interface PendingNativeSendReview {
  networkId: string;
  recipientInput: string;
  recipientResolution: RecipientResolution;
  amountInput: string;
  createdAt: string;
}

export interface WalletConnectSessionActivity {
  topic: string;
  domain: string;
  lastActiveAt: string;
  methodCounts: Record<string, number>;
}

export interface ImportedErc20Token {
  networkId: string;
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  priceKey?: string;
}

export interface PendingWalletConnectProposal {
  id: number;
  name: string;
  description: string;
  url: string;
  icons: string[];
  requiredChains: string[];
  optionalChains: string[];
  requiredMethods: string[];
  optionalMethods: string[];
  requiredEvents: string[];
  optionalEvents: string[];
  receivedAt: string;
  expiresAt?: string;
  unsupportedChains: string[];
  riskyMethods: string[];
  domainMismatch: boolean;
}

export const DEFAULT_WALLET_UI_SETTINGS: WalletUiSettings = {
  privacyMode: false,
  compactMode: false,
  defaultCurrency: "USD",
  startPage: "portal",
  visibleWidgets: ["balance", "assets", "send", "receive", "activity", "portfolio"],
  widgetOrder: ["balance", "assets", "send", "receive", "swap", "activity", "portfolio"],
  collapsedWidgets: [],
  defaultSendNetworkId: null,
  language: "en"
};

const WALLET_KEY = "walletRecord";
const NETWORK_SETTINGS_KEY = "networkSettings";
const ASSET_STORE_KEY = "assetStore";
const WALLET_UI_SETTINGS_KEY = "walletUiSettings";
const WALLETCONNECT_PENDING_PROPOSALS_KEY = "walletConnectPendingProposals";
const ACTIVITY_EVENTS_KEY = "activityEvents";
const RECENT_RECIPIENTS_KEY = "recentRecipients";
const WALLETCONNECT_SESSION_ACTIVITY_KEY = "walletConnectSessionActivity";
const IMPORTED_ERC20_TOKENS_KEY = "importedErc20Tokens";
const PENDING_NATIVE_SEND_REVIEW_KEY = "pendingNativeSendReview";
const ADDRESS_BOOK_CONTACTS_KEY = "addressBookContacts";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function chromeLocalStorage() {
  if (!chrome.storage?.local) {
    throw new Error("Chrome local storage is unavailable.");
  }

  return chrome.storage.local;
}

function normalizeAssetStore(store: AssetStore | undefined): AssetStore {
  const empty = emptyAssetStore();
  const next: AssetStore = {
    ...empty,
    ...(store ?? {}),
    assetDefinitions: store?.assetDefinitions ?? {},
    assetBalances: store?.assetBalances ?? {},
    assetPrices: store?.assetPrices ?? {},
    chainAssetSnapshots: store?.chainAssetSnapshots ?? {},
    portfolioSnapshot: store?.portfolioSnapshot ?? null
  };

  if (next.portfolioSnapshot) {
    next.portfolioSnapshot = {
      ...next.portfolioSnapshot,
      chainIds: next.portfolioSnapshot.chainIds ?? [],
      failedNetworkIds: next.portfolioSnapshot.failedNetworkIds ?? [],
      refreshedAt: next.portfolioSnapshot.refreshedAt ?? next.portfolioSnapshot.lastUpdatedAt ?? new Date(0).toISOString(),
      lastUpdatedAt: next.portfolioSnapshot.lastUpdatedAt ?? next.portfolioSnapshot.refreshedAt ?? new Date(0).toISOString(),
      staleAt: next.portfolioSnapshot.staleAt ?? new Date(0).toISOString()
    };
  }

  for (const [networkId, snapshot] of Object.entries(next.chainAssetSnapshots)) {
    next.chainAssetSnapshots[networkId] = {
      ...snapshot,
      assetIds: snapshot.assetIds ?? [],
      tokenAssetIds: snapshot.tokenAssetIds ?? []
    };
  }

  return next;
}

function normalizeWalletUiSettings(settings: Partial<WalletUiSettings> | undefined): WalletUiSettings {
  const widgetOrder = normalizePortalWidgetIds(settings?.widgetOrder, DEFAULT_WALLET_UI_SETTINGS.widgetOrder, true);
  const visibleWidgets = normalizePortalWidgetIds(settings?.visibleWidgets, DEFAULT_WALLET_UI_SETTINGS.visibleWidgets, false);

  return {
    ...DEFAULT_WALLET_UI_SETTINGS,
    ...(settings ?? {}),
    privacyMode: settings?.privacyMode ?? DEFAULT_WALLET_UI_SETTINGS.privacyMode,
    compactMode: settings?.compactMode ?? DEFAULT_WALLET_UI_SETTINGS.compactMode,
    defaultCurrency: "USD",
    startPage: settings?.startPage === "send" || settings?.startPage === "receive" ? settings.startPage : "portal",
    visibleWidgets,
    widgetOrder,
    collapsedWidgets: Array.isArray(settings?.collapsedWidgets)
      ? settings.collapsedWidgets
      : DEFAULT_WALLET_UI_SETTINGS.collapsedWidgets,
    defaultSendNetworkId:
      typeof settings?.defaultSendNetworkId === "string" || settings?.defaultSendNetworkId === null
        ? settings.defaultSendNetworkId
        : DEFAULT_WALLET_UI_SETTINGS.defaultSendNetworkId,
    language:
      typeof settings?.language === "string" ? settings.language : DEFAULT_WALLET_UI_SETTINGS.language
  };
}

function normalizePortalWidgetIds(ids: string[] | undefined, fallback: string[], appendMissing: boolean): string[] {
  const supported = new Set(DEFAULT_WALLET_UI_SETTINGS.widgetOrder);
  const expanded = (Array.isArray(ids) ? ids : fallback).flatMap((id) =>
    id === "actions" ? ["send", "receive", "swap", "activity"] : [id]
  );
  const normalized = Array.from(new Set(expanded.filter((id) => supported.has(id))));

  if (!normalized.length) {
    return fallback;
  }

  return appendMissing
    ? [...normalized, ...DEFAULT_WALLET_UI_SETTINGS.widgetOrder.filter((id) => !normalized.includes(id))]
    : normalized;
}

export async function readWalletRecord(): Promise<WalletRecord | null> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(WALLET_KEY);
    return (result[WALLET_KEY] as WalletRecord | null) ?? null;
  }

  const raw = localStorage.getItem(WALLET_KEY);
  return raw ? (JSON.parse(raw) as WalletRecord) : null;
}

export async function writeWalletRecord(record: WalletRecord): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [WALLET_KEY]: record });
    return;
  }

  localStorage.setItem(WALLET_KEY, JSON.stringify(record));
}

export async function clearWalletRecord(): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().remove(WALLET_KEY);
    return;
  }

  localStorage.removeItem(WALLET_KEY);
}

export async function readNetworkSettings(): Promise<WalletNetworkSetting[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(NETWORK_SETTINGS_KEY);
    return (result[NETWORK_SETTINGS_KEY] as WalletNetworkSetting[] | undefined) ?? [];
  }

  const raw = localStorage.getItem(NETWORK_SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as WalletNetworkSetting[]) : [];
}

export async function writeNetworkSettings(settings: WalletNetworkSetting[]): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [NETWORK_SETTINGS_KEY]: settings });
    return;
  }

  localStorage.setItem(NETWORK_SETTINGS_KEY, JSON.stringify(settings));
}

export async function readAssetStore(): Promise<AssetStore> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(ASSET_STORE_KEY);
    return normalizeAssetStore(result[ASSET_STORE_KEY] as AssetStore | undefined);
  }

  const raw = localStorage.getItem(ASSET_STORE_KEY);
  return raw ? normalizeAssetStore(JSON.parse(raw) as AssetStore) : emptyAssetStore();
}

export async function writeAssetStore(store: AssetStore): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [ASSET_STORE_KEY]: store });
    return;
  }

  localStorage.setItem(ASSET_STORE_KEY, JSON.stringify(store));
}

export async function readWalletUiSettings(): Promise<WalletUiSettings> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(WALLET_UI_SETTINGS_KEY);
    return normalizeWalletUiSettings(result[WALLET_UI_SETTINGS_KEY] as Partial<WalletUiSettings> | undefined);
  }

  const raw = localStorage.getItem(WALLET_UI_SETTINGS_KEY);
  return raw ? normalizeWalletUiSettings(JSON.parse(raw) as Partial<WalletUiSettings>) : DEFAULT_WALLET_UI_SETTINGS;
}

export async function writeWalletUiSettings(settings: WalletUiSettings): Promise<void> {
  const nextSettings = normalizeWalletUiSettings(settings);

  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [WALLET_UI_SETTINGS_KEY]: nextSettings });
    return;
  }

  localStorage.setItem(WALLET_UI_SETTINGS_KEY, JSON.stringify(nextSettings));
}

export async function readPendingWalletConnectProposals(): Promise<PendingWalletConnectProposal[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(WALLETCONNECT_PENDING_PROPOSALS_KEY);
    return (result[WALLETCONNECT_PENDING_PROPOSALS_KEY] as PendingWalletConnectProposal[] | undefined) ?? [];
  }

  const raw = localStorage.getItem(WALLETCONNECT_PENDING_PROPOSALS_KEY);
  return raw ? (JSON.parse(raw) as PendingWalletConnectProposal[]) : [];
}

export async function writePendingWalletConnectProposals(proposals: PendingWalletConnectProposal[]): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [WALLETCONNECT_PENDING_PROPOSALS_KEY]: proposals });
    return;
  }

  localStorage.setItem(WALLETCONNECT_PENDING_PROPOSALS_KEY, JSON.stringify(proposals));
}

export async function upsertPendingWalletConnectProposal(proposal: PendingWalletConnectProposal): Promise<void> {
  const proposals = await readPendingWalletConnectProposals();
  await writePendingWalletConnectProposals([proposal, ...proposals.filter((item) => item.id !== proposal.id)]);
}

export async function removePendingWalletConnectProposal(id: number): Promise<void> {
  const proposals = await readPendingWalletConnectProposals();
  await writePendingWalletConnectProposals(proposals.filter((proposal) => proposal.id !== id));
}

export async function readActivityEvents(): Promise<ActivityEvent[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(ACTIVITY_EVENTS_KEY);
    return ((result[ACTIVITY_EVENTS_KEY] as unknown[] | undefined) ?? [])
      .map(normalizeActivityEvent)
      .filter((event): event is ActivityEvent => Boolean(event));
  }

  const raw = localStorage.getItem(ACTIVITY_EVENTS_KEY);
  return raw
    ? (JSON.parse(raw) as unknown[])
      .map(normalizeActivityEvent)
      .filter((event): event is ActivityEvent => Boolean(event))
    : [];
}

export async function writeActivityEvents(events: ActivityEvent[]): Promise<void> {
  const nextEvents = events.slice(0, 80);

  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [ACTIVITY_EVENTS_KEY]: nextEvents });
    return;
  }

  localStorage.setItem(ACTIVITY_EVENTS_KEY, JSON.stringify(nextEvents));
}

export async function appendActivityEvent(event: ActivityEventInput): Promise<ActivityEvent[]> {
  const events = await readActivityEvents();
  const nextEvent = createActivityEvent(event);
  const nextEvents = [nextEvent, ...events].slice(0, 80);
  await writeActivityEvents(nextEvents);
  return nextEvents;
}

export async function readRecentRecipients(): Promise<RecentRecipient[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(RECENT_RECIPIENTS_KEY);
    return (result[RECENT_RECIPIENTS_KEY] as RecentRecipient[] | undefined) ?? [];
  }

  const raw = localStorage.getItem(RECENT_RECIPIENTS_KEY);
  return raw ? (JSON.parse(raw) as RecentRecipient[]) : [];
}

export async function writeRecentRecipients(recipients: RecentRecipient[]): Promise<void> {
  const nextRecipients = recipients.slice(0, 12);

  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [RECENT_RECIPIENTS_KEY]: nextRecipients });
    return;
  }

  localStorage.setItem(RECENT_RECIPIENTS_KEY, JSON.stringify(nextRecipients));
}

export async function upsertRecentRecipient(recipient: RecentRecipient): Promise<RecentRecipient[]> {
  const recipients = await readRecentRecipients();
  const nextRecipients = [
    recipient,
    ...recipients.filter(
      (item) => item.address.toLowerCase() !== recipient.address.toLowerCase() || item.networkId !== recipient.networkId
    )
  ].slice(0, 12);
  await writeRecentRecipients(nextRecipients);
  return nextRecipients;
}

export async function readAddressBookContacts(): Promise<AddressBookContact[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(ADDRESS_BOOK_CONTACTS_KEY);
    return ((result[ADDRESS_BOOK_CONTACTS_KEY] as unknown[] | undefined) ?? [])
      .map(normalizeAddressBookContact)
      .filter((contact): contact is AddressBookContact => Boolean(contact));
  }

  const raw = localStorage.getItem(ADDRESS_BOOK_CONTACTS_KEY);
  return raw
    ? (JSON.parse(raw) as unknown[])
      .map(normalizeAddressBookContact)
      .filter((contact): contact is AddressBookContact => Boolean(contact))
    : [];
}

export async function writeAddressBookContacts(contacts: AddressBookContact[]): Promise<void> {
  const nextContacts = contacts.slice(0, 200);

  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [ADDRESS_BOOK_CONTACTS_KEY]: nextContacts });
    return;
  }

  localStorage.setItem(ADDRESS_BOOK_CONTACTS_KEY, JSON.stringify(nextContacts));
}

export async function addAddressBookContact(input: AddressBookContactInput): Promise<AddressBookContact[]> {
  const contacts = await readAddressBookContacts();
  const nextContact = createAddressBookContact(input);
  const nextContacts = [nextContact, ...contacts.filter((contact) => contact.address.toLowerCase() !== nextContact.address.toLowerCase())];
  await writeAddressBookContacts(nextContacts);
  return nextContacts;
}

export async function updateAddressBookContact(
  contactId: string,
  update: (contact: AddressBookContact) => AddressBookContact
): Promise<AddressBookContact[]> {
  const contacts = await readAddressBookContacts();
  const nextContacts = contacts.map((contact) => contact.id === contactId ? { ...update(contact), updatedAt: new Date().toISOString() } : contact);
  await writeAddressBookContacts(nextContacts);
  return nextContacts;
}

export async function removeAddressBookContact(contactId: string): Promise<AddressBookContact[]> {
  const contacts = await readAddressBookContacts();
  const nextContacts = contacts.filter((contact) => contact.id !== contactId);
  await writeAddressBookContacts(nextContacts);
  return nextContacts;
}

export async function readPendingNativeSendReview(): Promise<PendingNativeSendReview | null> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(PENDING_NATIVE_SEND_REVIEW_KEY);
    return (result[PENDING_NATIVE_SEND_REVIEW_KEY] as PendingNativeSendReview | null) ?? null;
  }

  const raw = localStorage.getItem(PENDING_NATIVE_SEND_REVIEW_KEY);
  return raw ? (JSON.parse(raw) as PendingNativeSendReview) : null;
}

export async function writePendingNativeSendReview(review: PendingNativeSendReview): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [PENDING_NATIVE_SEND_REVIEW_KEY]: review });
    return;
  }

  localStorage.setItem(PENDING_NATIVE_SEND_REVIEW_KEY, JSON.stringify(review));
}

export async function clearPendingNativeSendReview(): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().remove(PENDING_NATIVE_SEND_REVIEW_KEY);
    return;
  }

  localStorage.removeItem(PENDING_NATIVE_SEND_REVIEW_KEY);
}

export async function readWalletConnectSessionActivity(): Promise<Record<string, WalletConnectSessionActivity>> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(WALLETCONNECT_SESSION_ACTIVITY_KEY);
    return (result[WALLETCONNECT_SESSION_ACTIVITY_KEY] as Record<string, WalletConnectSessionActivity> | undefined) ?? {};
  }

  const raw = localStorage.getItem(WALLETCONNECT_SESSION_ACTIVITY_KEY);
  return raw ? (JSON.parse(raw) as Record<string, WalletConnectSessionActivity>) : {};
}

export async function writeWalletConnectSessionActivity(activity: Record<string, WalletConnectSessionActivity>): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [WALLETCONNECT_SESSION_ACTIVITY_KEY]: activity });
    return;
  }

  localStorage.setItem(WALLETCONNECT_SESSION_ACTIVITY_KEY, JSON.stringify(activity));
}

export async function recordWalletConnectSessionActivity(input: {
  topic: string;
  method: string;
  domain: string;
}): Promise<Record<string, WalletConnectSessionActivity>> {
  const activity = await readWalletConnectSessionActivity();
  const current = activity[input.topic];
  const next: WalletConnectSessionActivity = {
    topic: input.topic,
    domain: input.domain,
    lastActiveAt: new Date().toISOString(),
    methodCounts: {
      ...(current?.methodCounts ?? {}),
      [input.method]: (current?.methodCounts[input.method] ?? 0) + 1
    }
  };
  const nextActivity = {
    ...activity,
    [input.topic]: next
  };
  await writeWalletConnectSessionActivity(nextActivity);
  return nextActivity;
}

export async function removeWalletConnectSessionActivity(topic: string): Promise<void> {
  const activity = await readWalletConnectSessionActivity();
  delete activity[topic];
  await writeWalletConnectSessionActivity(activity);
}

export async function readImportedErc20Tokens(): Promise<ImportedErc20Token[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(IMPORTED_ERC20_TOKENS_KEY);
    return (result[IMPORTED_ERC20_TOKENS_KEY] as ImportedErc20Token[] | undefined) ?? [];
  }

  const raw = localStorage.getItem(IMPORTED_ERC20_TOKENS_KEY);
  return raw ? (JSON.parse(raw) as ImportedErc20Token[]) : [];
}

export async function writeImportedErc20Tokens(tokens: ImportedErc20Token[]): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [IMPORTED_ERC20_TOKENS_KEY]: tokens });
    return;
  }

  localStorage.setItem(IMPORTED_ERC20_TOKENS_KEY, JSON.stringify(tokens));
}
