import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  EyeOff,
  FileText,
  Image as ImageIcon,
  KeyRound,
  RefreshCw,
  Save,
  Store,
  Utensils,
} from "lucide-react";
import { foodCatalog } from "./data/catalog";
import {
  applyCatalogPatch,
  emptyCatalogPatch,
  itemKey,
  normalizeCatalogPatch,
  type CatalogPatch,
} from "./data/catalogPatch";
import { loadCatalogPatch, saveCatalogPatch } from "./data/catalogPatchApi";
import { loadAdminSubmissions, updateSubmissionStatus } from "./data/studentSubmissions";
import type { StudentSubmission } from "./domain/feedback";
import {
  campusLabels,
  channelLabels,
  foodTypeLabels,
  heatLabels,
  mealPeriodLabels,
  vendorChannels,
  type Campus,
  type Channel,
  type FoodItem,
  type FoodType,
  type FoodVendor,
  type HeatLevel,
  type MealPeriod,
} from "./domain/food";

const adminTokenKey = "xdu-food-admin-token-v1";

const defaultVendorForm: VendorForm = {
  id: "",
  name: "",
  campus: "south",
  channel: "canteen",
  supportedChannels: "canteen",
  area: "",
  floor: "",
  windowNo: "",
  windowName: "",
  locationHint: "",
  distanceMinutes: "8",
  deliveryMinutes: "",
  rating: "",
  busyLevel: "",
  tags: "rice,protein",
  source: "后台修订",
};

const defaultItemForm: ItemForm = {
  id: "",
  name: "",
  price: "",
  types: "rice,protein",
  heat: "none",
  popularity: "0.7",
  available: "lunch,dinner",
  description: "",
};

function AdminApp() {
  const [token, setToken] = useState(() => window.localStorage.getItem(adminTokenKey) ?? "");
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [patch, setPatch] = useState<CatalogPatch>(emptyCatalogPatch);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [vendorForm, setVendorForm] = useState<VendorForm>(defaultVendorForm);
  const [itemForm, setItemForm] = useState<ItemForm>(defaultItemForm);
  const [notice, setNotice] = useState("");

  const catalog = useMemo(() => applyCatalogPatch(foodCatalog, patch), [patch]);
  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId);
  const selectedVendor = catalog.find((vendor) => vendor.id === selectedVendorId);
  const selectedItem = selectedVendor?.items.find((item) => item.id === selectedItemId);

  useEffect(() => {
    refreshAll();
  }, []);

  function rememberToken(nextToken = token) {
    window.localStorage.setItem(adminTokenKey, nextToken);
    setToken(nextToken);
  }

  async function refreshAll() {
    try {
      const nextPatch = await loadCatalogPatch();
      setPatch(nextPatch);
    } catch {
      setNotice("菜单修订暂时读取失败。");
    }

    if (!token) return;
    try {
      setSubmissions(await loadAdminSubmissions(token));
      setNotice("后台数据已刷新。");
    } catch {
      setNotice("管理员令牌无效，或手机后端暂时不可用。");
    }
  }

  function selectVendor(vendorId: string) {
    const vendor = catalog.find((entry) => entry.id === vendorId);
    setSelectedVendorId(vendorId);
    setSelectedItemId("");
    setVendorForm(vendor ? vendorToForm(vendor) : defaultVendorForm);
    setItemForm(defaultItemForm);
  }

  function selectItem(itemId: string) {
    const item = selectedVendor?.items.find((entry) => entry.id === itemId);
    setSelectedItemId(itemId);
    setItemForm(item ? itemToForm(item) : defaultItemForm);
  }

  function startNewVendor() {
    setSelectedVendorId("");
    setSelectedItemId("");
    setVendorForm(defaultVendorForm);
    setItemForm(defaultItemForm);
  }

  function startNewDish() {
    setSelectedItemId("");
    setItemForm(defaultItemForm);
  }

  function useSubmission(submission: StudentSubmission) {
    const vendorId = submission.vendorId || slugify(submission.vendorName);
    const existingVendor = catalog.find((vendor) => vendor.id === submission.vendorId);
    setSelectedSubmissionId(submission.id);
    setSelectedVendorId(existingVendor?.id ?? "");
    setSelectedItemId(submission.itemId ?? "");
    setVendorForm({
      ...defaultVendorForm,
      ...(existingVendor ? vendorToForm(existingVendor) : {}),
      id: existingVendor?.id ?? vendorId,
      name: submission.vendorName,
      campus: submission.campus,
      channel: submission.channel,
      supportedChannels: (submission.supportedChannels ?? [submission.channel]).join(","),
      area: submission.area,
      floor: submission.floor ?? "",
      windowNo: submission.windowNo ?? "",
      tags: submission.suggestedTags || existingVendor?.tags.join(",") || defaultVendorForm.tags,
    });
    setItemForm({
      ...defaultItemForm,
      id: submission.itemId || slugify(submission.suggestedDish || submission.itemName || "new-dish"),
      name: submission.suggestedDish || submission.itemName || "",
      price: submission.suggestedPrice ? String(submission.suggestedPrice) : "",
      types: submission.suggestedTags || defaultItemForm.types,
      description: submission.note || "",
    });
    setNotice("已把反馈填入编辑表单，确认后点击保存菜单修订。");
  }

  async function saveEditor() {
    if (!token) {
      setNotice("请先输入管理员令牌。");
      return;
    }

    const vendor = formToVendor(vendorForm, selectedVendor);
    const item = itemForm.name.trim() ? formToItem(itemForm, selectedItem) : null;
    const nextPatch = clonePatch(patch);
    const baseVendorExists = foodCatalog.some((entry) => entry.id === vendor.id);
    const addedVendorIndex = nextPatch.addedVendors.findIndex((entry) => entry.id === vendor.id);

    if (baseVendorExists) {
      nextPatch.vendorOverrides[vendor.id] = vendorOverride(vendor);
      if (item) upsertPatchedItem(nextPatch, vendor, item, Boolean(selectedVendor?.items.some((entry) => entry.id === item.id)));
    } else if (addedVendorIndex >= 0) {
      const current = nextPatch.addedVendors[addedVendorIndex];
      const items = item ? upsertItems(current.items, item) : current.items;
      nextPatch.addedVendors[addedVendorIndex] = { ...vendor, items };
    } else {
      nextPatch.addedVendors.unshift({ ...vendor, items: item ? [item] : [] });
    }

    try {
      const saved = await saveCatalogPatch(nextPatch, token);
      setPatch(saved);
      setSelectedVendorId(vendor.id);
      if (item) setSelectedItemId(item.id);
      setNotice("菜单修订已保存，普通前台刷新后生效。");
      if (selectedSubmission) {
        setSubmissions(await updateSubmissionStatus(selectedSubmission.id, "applied", token));
      }
    } catch {
      setNotice("保存失败，请检查管理员令牌。");
    }
  }

  async function markSubmission(status: "reviewed" | "applied" | "rejected") {
    if (!token || !selectedSubmission) return;
    try {
      setSubmissions(await updateSubmissionStatus(selectedSubmission.id, status, token));
      setNotice("反馈状态已更新。");
    } catch {
      setNotice("更新反馈状态失败。");
    }
  }

  async function hideSelectedVendor() {
    if (!token || !selectedVendorId) return;
    const nextPatch = clonePatch(patch);
    nextPatch.hiddenVendorIds = Array.from(new Set([...nextPatch.hiddenVendorIds, selectedVendorId]));
    setPatch(await saveCatalogPatch(nextPatch, token));
    startNewVendor();
    setNotice("商户已隐藏。");
  }

  async function hideSelectedItem() {
    if (!token || !selectedVendorId || !selectedItemId) return;
    const nextPatch = clonePatch(patch);
    nextPatch.hiddenItemIds = Array.from(new Set([...nextPatch.hiddenItemIds, itemKey(selectedVendorId, selectedItemId)]));
    setPatch(await saveCatalogPatch(nextPatch, token));
    setSelectedItemId("");
    setItemForm(defaultItemForm);
    setNotice("菜品已隐藏。");
  }

  return (
    <main className="adminShell">
      <header className="adminTopbar">
        <div>
          <p className="eyebrow">XDU FOOD ORACLE ADMIN</p>
          <h1>反馈与菜单后台</h1>
        </div>
        <div className="adminAuth">
          <KeyRound size={16} />
          <input
            type="password"
            value={token}
            onChange={(event) => rememberToken(event.target.value)}
            placeholder="管理员令牌"
          />
          <button onClick={refreshAll}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </header>

      <section className="adminStats">
        <AdminMetric icon={<FileText size={18} />} label="反馈" value={`${submissions.length} 条`} />
        <AdminMetric icon={<Store size={18} />} label="商户" value={`${catalog.length} 家`} />
        <AdminMetric icon={<Utensils size={18} />} label="菜品" value={`${catalog.reduce((sum, vendor) => sum + vendor.items.length, 0)} 个`} />
        <AdminMetric icon={<Save size={18} />} label="修订时间" value={patch.updatedAt ? patch.updatedAt.slice(5, 16).replace("T", " ") : "未修订"} />
      </section>

      <section className="adminGrid">
        <aside className="submissionPanel">
          <div className="adminSectionHeader">
            <h2>学生反馈</h2>
            <span>{submissions.filter((entry) => entry.status === "pending").length} 条待处理</span>
          </div>
          <div className="submissionList">
            {submissions.map((submission) => (
              <button
                key={submission.id}
                className={submission.id === selectedSubmissionId ? "submissionItem active" : "submissionItem"}
                onClick={() => setSelectedSubmissionId(submission.id)}
              >
                <strong>{submission.vendorName}</strong>
                <span>{submission.area} · {submission.suggestedDish || submission.itemName || "商户信息"}</span>
                <small>{submission.status} · {new Date(submission.createdAt).toLocaleString()}</small>
              </button>
            ))}
            {!submissions.length ? <div className="adminEmpty">暂无反馈，或尚未输入有效管理员令牌。</div> : null}
          </div>
        </aside>

        <section className="detailPanel">
          <div className="adminSectionHeader">
            <h2>反馈详情</h2>
            <div className="inlineActions">
              <button disabled={!selectedSubmission} onClick={() => selectedSubmission && useSubmission(selectedSubmission)}>
                <Check size={15} />
                填入表单
              </button>
              <button disabled={!selectedSubmission} onClick={() => markSubmission("reviewed")}>已看</button>
              <button disabled={!selectedSubmission} onClick={() => markSubmission("rejected")}>拒绝</button>
            </div>
          </div>
          {selectedSubmission ? (
            <div className="submissionDetail">
              <dl>
                <dt>类型</dt>
                <dd>{selectedSubmission.kind}</dd>
                <dt>校区</dt>
                <dd>{campusLabels[selectedSubmission.campus]}</dd>
                <dt>渠道</dt>
                <dd>{channelLabels[selectedSubmission.channel]}</dd>
                <dt>支持方式</dt>
                <dd>{(selectedSubmission.supportedChannels ?? [selectedSubmission.channel]).map((channel) => channelLabels[channel]).join(" / ")}</dd>
                <dt>联系方式</dt>
                <dd>{selectedSubmission.contact || "未填写"}</dd>
                <dt>菜单照片</dt>
                <dd>{selectedSubmission.attachmentCount || selectedSubmission.attachments?.length || 0} 张</dd>
              </dl>
              {selectedSubmission.attachments?.length ? (
                <div className="adminPhotoGrid">
                  {selectedSubmission.attachments.map((photo) => (
                    <a key={photo.id} href={photo.dataUrl} target="_blank" rel="noreferrer" className="adminPhotoLink">
                      <img src={photo.dataUrl} alt={photo.name} />
                      <span>
                        <ImageIcon size={14} />
                        {photo.name}
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
              <p>{selectedSubmission.note || "新增候选，等待人工确认。"}</p>
            </div>
          ) : (
            <div className="adminEmpty">选择一条反馈查看详情。</div>
          )}
        </section>

        <section className="editorPanel">
          <div className="adminSectionHeader">
            <h2>商户与菜品编辑</h2>
            <div className="inlineActions">
              <button onClick={startNewVendor}>新增商户</button>
              <button onClick={startNewDish} disabled={!vendorForm.id && !selectedVendorId}>新增菜品</button>
              <button onClick={saveEditor}>
                <Save size={15} />
                保存修订
              </button>
            </div>
          </div>

          <div className="editorSelectors">
            <label>
              选择商户
              <select value={selectedVendorId} onChange={(event) => selectVendor(event.target.value)}>
                <option value="">新商户</option>
                {catalog.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name} · {vendor.area}
                  </option>
                ))}
              </select>
            </label>
            <label>
              选择菜品
              <select value={selectedItemId} onChange={(event) => selectItem(event.target.value)} disabled={!selectedVendor}>
                <option value="">新菜品</option>
                {selectedVendor?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="adminFormGrid">
            <Field label="商户 ID" value={vendorForm.id} onChange={(value) => setVendorForm({ ...vendorForm, id: value })} />
            <Field label="商户名称" value={vendorForm.name} onChange={(value) => setVendorForm({ ...vendorForm, name: value })} />
            <Choice label="校区" value={vendorForm.campus} options={campusOptions} onChange={(value) => setVendorForm({ ...vendorForm, campus: value as Campus })} />
            <Choice label="渠道" value={vendorForm.channel} options={channelOptions} onChange={(value) => setVendorForm({ ...vendorForm, channel: value as Channel })} />
            <Field label="支持方式" value={vendorForm.supportedChannels} onChange={(value) => setVendorForm({ ...vendorForm, supportedChannels: value })} />
            <Field label="区域" value={vendorForm.area} onChange={(value) => setVendorForm({ ...vendorForm, area: value })} />
            <Field label="楼层" value={vendorForm.floor} onChange={(value) => setVendorForm({ ...vendorForm, floor: value })} />
            <Field label="档口号" value={vendorForm.windowNo} onChange={(value) => setVendorForm({ ...vendorForm, windowNo: value })} />
            <Field label="档口名" value={vendorForm.windowName} onChange={(value) => setVendorForm({ ...vendorForm, windowName: value })} />
            <Field label="位置提示" value={vendorForm.locationHint} onChange={(value) => setVendorForm({ ...vendorForm, locationHint: value })} />
            <Field label="标签" value={vendorForm.tags} onChange={(value) => setVendorForm({ ...vendorForm, tags: value })} />
            <Field label="菜品 ID" value={itemForm.id} onChange={(value) => setItemForm({ ...itemForm, id: value })} />
            <Field label="菜品名称" value={itemForm.name} onChange={(value) => setItemForm({ ...itemForm, name: value })} />
            <Field label="价格" value={itemForm.price} onChange={(value) => setItemForm({ ...itemForm, price: value })} />
            <Field label="菜品标签" value={itemForm.types} onChange={(value) => setItemForm({ ...itemForm, types: value })} />
            <Choice label="辣度" value={itemForm.heat} options={heatOptions} onChange={(value) => setItemForm({ ...itemForm, heat: value as HeatLevel })} />
            <Field label="供应餐别" value={itemForm.available} onChange={(value) => setItemForm({ ...itemForm, available: value })} />
            <label className="wideField">
              描述
              <textarea value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} />
            </label>
          </div>
          <div className="dangerActions">
            <button disabled={!selectedVendorId} onClick={hideSelectedVendor}>
              <EyeOff size={15} />
              隐藏商户
            </button>
            <button disabled={!selectedVendorId || !selectedItemId} onClick={hideSelectedItem}>
              <EyeOff size={15} />
              隐藏菜品
            </button>
          </div>
        </section>
      </section>

      {notice ? <div className="toastMessage">{notice}</div> : null}
    </main>
  );
}

function AdminMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="adminMetric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function vendorToForm(vendor: FoodVendor): VendorForm {
  return {
    id: vendor.id,
    name: vendor.name,
    campus: vendor.campus,
    channel: vendor.channel,
    supportedChannels: vendorChannels(vendor).join(","),
    area: vendor.area,
    floor: vendor.floor ?? "",
    windowNo: vendor.windowNo ?? "",
    windowName: vendor.windowName ?? "",
    locationHint: vendor.locationHint ?? "",
    distanceMinutes: String(vendor.distanceMinutes),
    deliveryMinutes: vendor.deliveryMinutes ? String(vendor.deliveryMinutes) : "",
    rating: vendor.rating ? String(vendor.rating) : "",
    busyLevel: vendor.busyLevel ? String(vendor.busyLevel) : "",
    tags: vendor.tags.join(","),
    source: vendor.source,
  };
}

function itemToForm(item: FoodItem): ItemForm {
  return {
    id: item.id,
    name: item.name,
    price: item.price ? String(item.price) : "",
    types: item.types.join(","),
    heat: item.heat,
    popularity: String(item.popularity),
    available: item.available.join(","),
    description: item.description,
  };
}

function formToVendor(form: VendorForm, existing?: FoodVendor): FoodVendor {
  const tags = parseFoodTypes(form.tags);
  return {
    id: form.id.trim() || slugify(form.name),
    name: form.name.trim(),
    campus: form.campus,
    channel: form.channel,
    supportedChannels: parseChannels(form.supportedChannels, form.channel),
    area: form.area.trim(),
    floor: form.floor.trim() || undefined,
    windowNo: form.windowNo.trim() || undefined,
    windowName: form.windowName.trim() || undefined,
    locationHint: form.locationHint.trim() || undefined,
    distanceMinutes: numberOr(form.distanceMinutes, existing?.distanceMinutes ?? 8),
    deliveryMinutes: form.deliveryMinutes ? numberOr(form.deliveryMinutes, 30) : undefined,
    rating: form.rating ? numberOr(form.rating, 4.5) : undefined,
    busyLevel: form.busyLevel ? numberOr(form.busyLevel, 0.5) : undefined,
    tags,
    source: form.source.trim() || "后台修订",
    updatedAt: new Date().toISOString().slice(0, 10),
    reviewStatus: "approved",
    sourceMethod: "manual-review",
    items: existing?.items ?? [],
  };
}

function formToItem(form: ItemForm, existing?: FoodItem): FoodItem {
  return {
    id: form.id.trim() || slugify(form.name),
    name: form.name.trim(),
    price: form.price ? numberOr(form.price, existing?.price ?? 0) : undefined,
    types: parseFoodTypes(form.types),
    heat: form.heat,
    popularity: numberOr(form.popularity, existing?.popularity ?? 0.7),
    available: parseMealPeriods(form.available),
    description: form.description.trim() || existing?.description || "后台人工补充菜品。",
    reviewStatus: "approved",
    sourceMethod: "manual-review",
  };
}

function vendorOverride(vendor: FoodVendor): Partial<FoodVendor> {
  const { items: _items, ...override } = vendor;
  return override;
}

function upsertPatchedItem(nextPatch: CatalogPatch, vendor: FoodVendor, item: FoodItem, existsInCatalog: boolean) {
  if (existsInCatalog) {
    nextPatch.itemOverrides[itemKey(vendor.id, item.id)] = item;
    return;
  }
  nextPatch.addedItems[vendor.id] = upsertItems(nextPatch.addedItems[vendor.id] ?? [], item);
}

function upsertItems(items: FoodItem[], item: FoodItem) {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    const next = [...items];
    next[index] = item;
    return next;
  }
  return [item, ...items];
}

function clonePatch(patch: CatalogPatch): CatalogPatch {
  return normalizeCatalogPatch(JSON.parse(JSON.stringify(patch)));
}

function parseFoodTypes(value: string): FoodType[] {
  const valid = new Set(Object.keys(foodTypeLabels) as FoodType[]);
  const byLabel = Object.fromEntries(Object.entries(foodTypeLabels).map(([key, label]) => [label, key])) as Record<string, FoodType>;
  const parsed = value
    .split(/[,，、\s]+/)
    .map((entry) => entry.trim())
    .map((entry) => byLabel[entry] ?? entry)
    .filter((entry): entry is FoodType => valid.has(entry as FoodType));
  return parsed.length ? Array.from(new Set(parsed)) : ["rice"];
}

function parseMealPeriods(value: string): MealPeriod[] {
  const valid = new Set(Object.keys(mealPeriodLabels) as MealPeriod[]);
  const parsed = value
    .split(/[,，、\s]+/)
    .map((entry) => entry.trim())
    .filter((entry): entry is MealPeriod => valid.has(entry as MealPeriod));
  return parsed.length ? Array.from(new Set(parsed)) : ["lunch", "dinner"];
}

function parseChannels(value: string, fallback: Channel): Channel[] {
  const valid = new Set(Object.keys(channelLabels) as Channel[]);
  const byLabel = Object.fromEntries(Object.entries(channelLabels).map(([key, label]) => [label, key])) as Record<string, Channel>;
  const parsed = value
    .split(/[,，、\s/]+/)
    .map((entry) => entry.trim())
    .map((entry) => byLabel[entry] ?? entry)
    .filter((entry): entry is Channel => valid.has(entry as Channel));
  return Array.from(new Set([fallback, ...parsed]));
}

function numberOr(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value: string) {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${ascii || "item"}-${suffix}`;
}

interface VendorForm {
  id: string;
  name: string;
  campus: Campus;
  channel: Channel;
  supportedChannels: string;
  area: string;
  floor: string;
  windowNo: string;
  windowName: string;
  locationHint: string;
  distanceMinutes: string;
  deliveryMinutes: string;
  rating: string;
  busyLevel: string;
  tags: string;
  source: string;
}

interface ItemForm {
  id: string;
  name: string;
  price: string;
  types: string;
  heat: HeatLevel;
  popularity: string;
  available: string;
  description: string;
}

const campusOptions = Object.entries(campusLabels).map(([value, label]) => ({ value, label }));
const channelOptions = Object.entries(channelLabels).map(([value, label]) => ({ value, label }));
const heatOptions = Object.entries(heatLabels).map(([value, label]) => ({ value, label }));

export default AdminApp;
