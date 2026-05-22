export interface AddressBookContact {
  id: string;
  name: string;
  address: string;
  ensName?: string;
  networkId?: string;
  networkName?: string;
  favorite: boolean;
  trusted: boolean;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AddressBookContactInput = Pick<AddressBookContact, "name" | "address"> &
  Partial<Pick<AddressBookContact, "ensName" | "networkId" | "networkName" | "favorite" | "trusted" | "lastUsedAt">>;

export function createAddressBookContact(input: AddressBookContactInput): AddressBookContact {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    address: input.address.trim(),
    ensName: input.ensName?.trim() || undefined,
    networkId: input.networkId,
    networkName: input.networkName,
    favorite: input.favorite ?? false,
    trusted: input.trusted ?? false,
    lastUsedAt: input.lastUsedAt,
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeAddressBookContact(value: unknown): AddressBookContact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const contact = value as Partial<AddressBookContact>;

  if (typeof contact.name !== "string" || typeof contact.address !== "string" || !contact.name.trim() || !contact.address.trim()) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: typeof contact.id === "string" && contact.id ? contact.id : crypto.randomUUID(),
    name: contact.name.trim(),
    address: contact.address.trim(),
    ensName: typeof contact.ensName === "string" && contact.ensName.trim() ? contact.ensName.trim() : undefined,
    networkId: typeof contact.networkId === "string" ? contact.networkId : undefined,
    networkName: typeof contact.networkName === "string" ? contact.networkName : undefined,
    favorite: Boolean(contact.favorite),
    trusted: Boolean(contact.trusted),
    lastUsedAt: typeof contact.lastUsedAt === "string" ? contact.lastUsedAt : undefined,
    createdAt: typeof contact.createdAt === "string" && contact.createdAt ? contact.createdAt : now,
    updatedAt: typeof contact.updatedAt === "string" && contact.updatedAt ? contact.updatedAt : now
  };
}

export function searchAddressBookContacts(contacts: AddressBookContact[], query: string): AddressBookContact[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return contacts;
  }

  return contacts.filter((contact) =>
    [contact.name, contact.address, contact.ensName ?? "", contact.networkName ?? "", contact.trusted ? "trusted" : "", contact.favorite ? "favorite" : ""]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}
