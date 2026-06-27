import { getCachedJson, setLocalJson } from './localDb';
import { emitMasterDataChanged, MasterDataEvent } from './masterEvents';

export type VariantOptionStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';

export type LocalVariantOptionPayload = {
  local_id: string;
  server_id: string | null;
  variant_group_local_id: string;
  variant_group_server_id: string | null;
  name: string;
  additional_price: number;
  hpp: number;
  sort_order: number;
  status: VariantOptionStatus;
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED';
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type VariantOptionInput = {
  name: string;
  additionalPrice?: number;
  hpp?: number;
  sortOrder?: number;
  status?: VariantOptionStatus;
};

const MASTER_KEY = 'foru:master_data';

function normalizeInput(input: VariantOptionInput) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Nama opsi wajib diisi.');
  const additionalPrice = Number(input.additionalPrice ?? 0);
  const hpp = Number(input.hpp ?? 0);
  if (additionalPrice < 0) throw new Error('Additional price tidak boleh negatif.');
  if (hpp < 0) throw new Error('HPP tidak boleh negatif.');
  return {
    name,
    additionalPrice,
    hpp,
    sortOrder: Number(input.sortOrder ?? 0),
    status: input.status || 'ACTIVE' as VariantOptionStatus,
  };
}

function masterData() {
  return getCachedJson<any>(MASTER_KEY, {});
}

async function saveMasterData(master: any, event: MasterDataEvent) {
  await setLocalJson(MASTER_KEY, master);
  emitMasterDataChanged(event);
}

function findVariantGroup(master: any, groupId: string) {
  return (master.variantGroups || []).find((group: any) => group.id === groupId || group.localId === groupId || group.local_id === groupId);
}

function optionToPayload(group: any, option: any, actionKey: string): LocalVariantOptionPayload {
  const now = new Date().toISOString();
  const localId = option.localId || option.local_id || option.id || `local_variant_option_${crypto.randomUUID()}`;
  const serverId = String(option.id || '').startsWith('local_') ? null : option.serverId || option.server_id || option.id || null;
  const groupLocalId = group.localId || group.local_id || group.id;
  const groupServerId = String(group.id || '').startsWith('local_') ? null : group.serverId || group.server_id || group.id || null;
  return {
    local_id: localId,
    server_id: serverId,
    variant_group_local_id: groupLocalId,
    variant_group_server_id: groupServerId,
    name: option.name,
    additional_price: Number(option.additionalPrice ?? option.additional_price ?? 0),
    hpp: Number(option.hpp ?? 0),
    sort_order: Number(option.sortOrder ?? option.sort_order ?? 0),
    status: option.status || 'ACTIVE',
    sync_status: option.syncStatus || option.sync_status || 'PENDING',
    idempotency_key: option.idempotencyKey || option.idempotency_key || `${actionKey}_${localId}_${Date.now()}`,
    created_at: option.createdAt || option.created_at || now,
    updated_at: option.updatedAt || option.updated_at || now,
    deleted_at: option.deletedAt || option.deleted_at || null,
  };
}

function applyOptionToProducts(master: any, groupId: string, option: any, mode: 'upsert' | 'delete') {
  master.products = (master.products || []).map((product: any) => ({
    ...product,
    variantGroups: (product.variantGroups || []).map((productGroup: any) => {
      const group = productGroup.group;
      if (!group || group.id !== groupId) return productGroup;
      const existing = group.options || [];
      const options = mode === 'delete'
        ? existing.map((row: any) => row.id === option.id ? option : row)
        : existing.some((row: any) => row.id === option.id)
          ? existing.map((row: any) => row.id === option.id ? option : row)
          : [...existing, option];
      return { ...productGroup, group: { ...group, options: options.sort((a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) } };
    }),
  }));
}

async function enqueueVariantOption(action: 'CREATE' | 'UPDATE' | 'DELETE', payload: LocalVariantOptionPayload) {
  const { enqueueSync } = await import('./sync');
  enqueueSync({
    id: payload.idempotency_key,
    entityType: 'VARIANT_OPTION',
    entityLocalId: payload.local_id,
    action,
    payload,
  });
}

export function getVariantGroupsFromLocal() {
  const master = masterData();
  return master.variantGroups || [];
}

export function getVariantOptionsByGroup(groupId: string) {
  const group = findVariantGroup(masterData(), groupId);
  return (group?.options || []).filter((option: any) => option.status !== 'DELETED');
}

export async function createVariantOption(groupId: string, input: VariantOptionInput) {
  const normalized = normalizeInput(input);
  const master = masterData();
  const group = findVariantGroup(master, groupId);
  if (!group) throw new Error('Variant group tidak ditemukan di data lokal.');
  const now = new Date().toISOString();
  const id = `local_variant_option_${crypto.randomUUID()}`;
  const option = {
    id,
    localId: id,
    serverId: null,
    variantGroupId: group.id,
    name: normalized.name,
    additionalPrice: normalized.additionalPrice,
    hpp: normalized.hpp,
    sortOrder: normalized.sortOrder,
    status: normalized.status,
    syncStatus: 'PENDING',
    idempotencyKey: `variant_option_create_${id}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    outlets: [],
  };
  group.options = [...(group.options || []), option].sort((a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  applyOptionToProducts(master, group.id, option, 'upsert');
  const payload = optionToPayload(group, option, 'variant_option_create');
  await setLocalJson(MASTER_KEY, master);
  await enqueueVariantOption('CREATE', payload);
  emitMasterDataChanged('variant_option_created', { groupId, optionId: id });
  return option;
}

export async function updateVariantOption(groupId: string, optionId: string, input: VariantOptionInput) {
  const normalized = normalizeInput(input);
  const master = masterData();
  const group = findVariantGroup(master, groupId);
  if (!group) throw new Error('Variant group tidak ditemukan di data lokal.');
  const options = group.options || [];
  const existing = options.find((option: any) => option.id === optionId || option.localId === optionId);
  if (!existing) throw new Error('Opsi varian tidak ditemukan.');
  const updated = {
    ...existing,
    name: normalized.name,
    additionalPrice: normalized.additionalPrice,
    hpp: normalized.hpp,
    sortOrder: normalized.sortOrder,
    status: normalized.status,
    syncStatus: 'PENDING',
    idempotencyKey: existing.idempotencyKey || `variant_option_update_${existing.localId || existing.id}_${Date.now()}`,
    updatedAt: new Date().toISOString(),
  };
  group.options = options.map((option: any) => option.id === existing.id ? updated : option).sort((a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  applyOptionToProducts(master, group.id, updated, 'upsert');
  const payload = optionToPayload(group, updated, 'variant_option_update');
  await setLocalJson(MASTER_KEY, master);
  await enqueueVariantOption('UPDATE', payload);
  emitMasterDataChanged('variant_option_updated', { groupId, optionId: updated.id });
  return updated;
}

export async function deleteVariantOption(groupId: string, optionId: string) {
  const master = masterData();
  const group = findVariantGroup(master, groupId);
  if (!group) throw new Error('Variant group tidak ditemukan di data lokal.');
  const existing = (group.options || []).find((option: any) => option.id === optionId || option.localId === optionId);
  if (!existing) throw new Error('Opsi varian tidak ditemukan.');
  const deleted = {
    ...existing,
    status: 'DELETED',
    syncStatus: 'PENDING',
    idempotencyKey: existing.idempotencyKey || `variant_option_delete_${existing.localId || existing.id}_${Date.now()}`,
    updatedAt: new Date().toISOString(),
    deletedAt: new Date().toISOString(),
  };
  group.options = (group.options || []).map((option: any) => option.id === existing.id ? deleted : option);
  applyOptionToProducts(master, group.id, deleted, 'delete');
  const payload = optionToPayload(group, deleted, 'variant_option_delete');
  await setLocalJson(MASTER_KEY, master);
  await enqueueVariantOption('DELETE', payload);
  emitMasterDataChanged('variant_option_deleted', { groupId, optionId: deleted.id });
  return deleted;
}

export async function setVariantOptionStatus(groupId: string, option: any, status: 'ACTIVE' | 'INACTIVE') {
  return updateVariantOption(groupId, option.id, {
    name: option.name,
    additionalPrice: Number(option.additionalPrice || 0),
    hpp: Number(option.hpp || 0),
    sortOrder: Number(option.sortOrder || 0),
    status,
  });
}
