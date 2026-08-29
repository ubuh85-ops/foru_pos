import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { API, rupiah } from "../api";

type PublicOption = { id: string; name: string; additionalPrice: number };
type PublicGroup = {
  group: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    required: boolean;
    options: PublicOption[];
  };
};
type PublicAddon = { id: string; addonName: string; price: number };
type PublicProduct = {
  id: string;
  name: string;
  sku?: string | null;
  category?: string;
  categoryRef?: { id: string; name: string; sortOrder?: number } | null;
  description?: string | null;
  imageUrl?: string | null;
  isAvailable: boolean;
  isRecommended: boolean;
  basePrice: number;
  variants?: { id: string; variantName: string; sellingPrice: number }[];
  addons?: PublicAddon[];
  variantGroups?: PublicGroup[];
};
type CartLine = {
  key: string;
  product: PublicProduct;
  qty: number;
  variantId?: string;
  optionIds: string[];
  addonIds: string[];
  note: string;
};
type Fulfillment = "DINE_IN" | "TAKE_AWAY" | "DELIVERY";

const API_ORIGIN = API.replace(/\/api\/?$/, "");
const imageSrc = (url?: string | null) =>
  !url
    ? "/images/foru.png"
    : url.startsWith("/storage/")
    ? `${API_ORIGIN}${url}`
    : url;
const publicFetch = async <T,>(path: string, init?: RequestInit) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Permintaan gagal");
  return data as T;
};
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
function zonedDateTimeIso(
  dateValue: string,
  timeValue: string,
  timeZone: string
) {
  const [year, month, day] = dateValue.split("-").map(Number),
    [hour, minute] = timeValue.split(":").map(Number);
  const wanted = Date.UTC(
    year || 0,
    (month || 1) - 1,
    day || 1,
    hour || 0,
    minute || 0
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wanted));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const represented = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute")
  );
  return new Date(wanted - (represented - wanted)).toISOString();
}

export default function CustomerOrderPage() {
  const { businessSlug = "", outletSlug = "" } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<any>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [modalError, setModalError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderType, setOrderType] = useState<Fulfillment>("DINE_IN");
  const [tableNumber, setTableNumber] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [isPreOrder, setIsPreOrder] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [preview, setPreview] = useState({
    subtotal: 0,
    productDiscount: 0,
    transactionDiscount: 0,
    couponDiscount: 0,
    total: 0,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Semua");
  const productPagerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  async function refreshAvailability() {
    const rows = await publicFetch<PublicProduct[]>(
      `/public/order/${businessSlug}/${outletSlug}/products`
    );
    setProducts(rows);
    const latest = new Map(rows.map((product) => [product.id, product]));
    setCart((current) =>
      current.map((line) =>
        latest.has(line.product.id)
          ? { ...line, product: latest.get(line.product.id)! }
          : line
      )
    );
    return rows;
  }

  useEffect(() => {
    Promise.all([
      publicFetch<any>(`/public/order/${businessSlug}/${outletSlug}`),
      publicFetch<PublicProduct[]>(
        `/public/order/${businessSlug}/${outletSlug}/products`
      ),
    ])
      .then(([info, rows]) => {
        setMeta(info);
        setProducts(rows);
        if (!info.outlet?.allowDineIn && info.outlet?.allowTakeAway)
          setOrderType("TAKE_AWAY");
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [businessSlug, outletSlug]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) refreshAvailability().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [businessSlug, outletSlug]);

  const total = useMemo(
    () =>
      cart.reduce((sum, line) => {
        const options =
          line.product.variantGroups
            ?.flatMap((v) => v.group.options)
            .filter((o) => line.optionIds.includes(o.id)) || [];
        const addons =
          line.product.addons?.filter((a) => line.addonIds.includes(a.id)) ||
          [];
        const variantPrice = line.product.variants?.find(
          (v) => v.id === line.variantId
        )?.sellingPrice;
        const unit =
          Number(variantPrice ?? line.product.basePrice ?? 0) +
          options.reduce((n, o) => n + Number(o.additionalPrice || 0), 0) +
          addons.reduce((n, a) => n + Number(a.price || 0), 0);
        return sum + unit * line.qty;
      }, 0),
    [cart]
  );
  const itemCount = cart.reduce((n, line) => n + line.qty, 0);
  const phoneValid = /^\+?[0-9][0-9\s-]{7,19}$/.test(customerPhone.trim());
  const formValid =
    !!cart.length &&
    cart.every((line) => line.product.isAvailable) &&
    customerName.trim().length >= 2 &&
    phoneValid &&
    (!isPreOrder || (!!scheduleDate && !!scheduleTime));
  const dateBounds = useMemo(() => {
    const today = new Date(),
      max = new Date();
    max.setDate(
      max.getDate() + Number(meta?.outlet?.preOrderMaxDaysAhead || 14)
    );
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    return { min: key(today), max: key(max) };
  }, [meta]);
  const slots = useMemo(() => {
    if (!scheduleDate || !meta?.outlet) return [] as string[];
    const selected = new Date(`${scheduleDate}T12:00:00`);
    if (!(meta.outlet.operatingDays || []).includes(selected.getDay()))
      return [];
    const minutes = (value: string) => {
      const [h, m] = value.split(":").map(Number);
      return h * 60 + m;
    };
    const open = minutes(meta.outlet.openTime),
      close = minutes(meta.outlet.closeTime),
      step = Number(meta.outlet.preOrderSlotMinutes);
    const earliest =
      Date.now() + Number(meta.outlet.preOrderMinLeadMinutes) * 60000;
    const rows: string[] = [];
    for (let value = open; value < close; value += step) {
      const time = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
        value % 60
      ).padStart(2, "0")}`;
      if (
        new Date(
          zonedDateTimeIso(scheduleDate, time, meta.outlet.timezone)
        ).getTime() >= earliest
      )
        rows.push(time);
    }
    return rows;
  }, [scheduleDate, meta]);

  useEffect(() => {
    if (!cart.length)
      return setPreview({
        subtotal: 0,
        productDiscount: 0,
        transactionDiscount: 0,
        couponDiscount: 0,
        total: 0,
      });
    const timer = window.setTimeout(
      () =>
        publicFetch<any>(
          `/public/order/${businessSlug}/${outletSlug}/preview`,
          {
            method: "POST",
            body: JSON.stringify({
              items: cart.map((line) => ({
                productId: line.product.id,
                variantId: line.variantId,
                selectedVariantOptionIds: line.optionIds,
                addonIds: line.addonIds,
                qty: line.qty,
                itemNote: line.note,
              })),
            }),
          }
        )
          .then(setPreview)
          .catch(() => setPreview((p) => ({ ...p, subtotal: total, total }))),
      150
    );
    return () => window.clearTimeout(timer);
  }, [cart, total, businessSlug, outletSlug]);
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      return (
        !q ||
        [
          product.name,
          product.sku,
          product.categoryRef?.name,
          product.category,
          product.description,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(q)
        )
      );
    });
  }, [products, search]);
  const groupedProducts = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sortOrder: number; products: PublicProduct[] }
    >();
    for (const product of filteredProducts) {
      const id = product.categoryRef?.id || product.category || "uncategorized";
      const name = product.categoryRef?.name || product.category || "Menu";
      if (!map.has(id))
        map.set(id, {
          id,
          name,
          sortOrder: Number(product.categoryRef?.sortOrder ?? 0),
          products: [],
        });
      map.get(id)!.products.push(product);
    }
    return Array.from(map.values()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );
  }, [filteredProducts]);
  const searchActive = search.trim().length > 0;
  const recommendationGroup = useMemo(() => {
    const recommended = filteredProducts.filter(
      (product) => product.isRecommended
    );
    return recommended.length
      ? {
          id: "recommended",
          name: "Rekomendasi",
          sortOrder: -1,
          products: recommended,
        }
      : null;
  }, [filteredProducts]);
  const categoryPages = useMemo(
    () => [
      {
        id: "all",
        name: "Semua",
        groups: recommendationGroup
          ? [recommendationGroup, ...groupedProducts]
          : groupedProducts,
      },
      ...(recommendationGroup
        ? [
            {
              id: recommendationGroup.id,
              name: recommendationGroup.name,
              groups: [recommendationGroup],
            },
          ]
        : []),
      ...groupedProducts.map((group) => ({
        id: group.id,
        name: group.name,
        groups: [group],
      })),
    ],
    [groupedProducts, recommendationGroup]
  );
  const categoryNav = useMemo(
    () => categoryPages.map((page) => page.name),
    [categoryPages]
  );

  useEffect(() => {
    if (!groupedProducts.length) {
      setActiveCategory("Semua");
      return;
    }
    if (
      !categoryPages.some((page) => page.name === activeCategory)
    ) {
      setActiveCategory("Semua");
    }
  }, [groupedProducts, categoryPages, activeCategory]);

  useEffect(() => {
    chipRefs.current[activeCategory]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeCategory]);

  function scrollToCategory(name: string) {
    setActiveCategory(name);
    if (searchActive) {
      if (name === "Semua") {
        productPagerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        return;
      }
      const group = groupedProducts.find((item) => item.name === name);
      if (group)
        sectionRefs.current[group.id]?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      return;
    }
    const index = categoryPages.findIndex((page) => page.name === name);
    const pager = productPagerRef.current;
    if (pager && index >= 0)
      pager.scrollTo({ left: index * pager.clientWidth, behavior: "smooth" });
  }
  function syncCategoryFromSwipe() {
    if (searchActive) return;
    const pager = productPagerRef.current;
    if (!pager?.clientWidth) return;
    const index = Math.max(
      0,
      Math.min(
        categoryPages.length - 1,
        Math.round(pager.scrollLeft / pager.clientWidth)
      )
    );
    const next = categoryPages[index]?.name || "Semua";
    if (next !== activeCategory) setActiveCategory(next);
  }

  function openProduct(product: PublicProduct, line?: CartLine) {
    if (!product.isAvailable) return;
    setSelected(product);
    setEditingKey(line?.key || null);
    setVariantId(
      line?.variantId ||
        (product.variants?.length === 1 ? product.variants[0]?.id : undefined)
    );
    setOptionIds(line?.optionIds || []);
    setAddonIds(line?.addonIds || []);
    setQty(line?.qty || 1);
    setNote(line?.note || "");
    setModalError("");
  }
  function toggleOption(group: PublicGroup["group"], id: string) {
    setOptionIds((current) => {
      const inGroup = new Set(group.options.map((o) => o.id));
      const exists = current.includes(id);
      if (exists) return current.filter((x) => x !== id);
      if (group.maxSelect <= 1)
        return [...current.filter((x) => !inGroup.has(x)), id];
      const count = current.filter((x) => inGroup.has(x)).length;
      if (count >= group.maxSelect) return current;
      return [...current, id];
    });
  }
  function addSelected() {
    if (!selected) return;
    if (!selected.isAvailable) {
      setModalError("Menu ini sedang habis.");
      return;
    }
    if (selected.variants?.length && !variantId) {
      setModalError("Pilih variant produk.");
      return;
    }
    for (const vg of selected.variantGroups || []) {
      const chosen = optionIds.filter((id) =>
        vg.group.options.some((o) => o.id === id)
      ).length;
      if (vg.group.required && chosen < vg.group.minSelect) {
        setModalError(
          `Pilih minimal ${vg.group.minSelect} opsi ${vg.group.name}.`
        );
        return;
      }
    }
    setCart((rows) =>
      editingKey
        ? rows.map((line) =>
            line.key === editingKey
              ? {
                  ...line,
                  product: selected,
                  qty,
                  variantId,
                  optionIds,
                  addonIds,
                  note,
                }
              : line
          )
        : [
            ...rows,
            {
              key: uid(),
              product: selected,
              qty,
              variantId,
              optionIds,
              addonIds,
              note,
            },
          ]
    );
    setSelected(null);
    setEditingKey(null);
    setModalError("");
  }
  function addProduct(product: PublicProduct) {
    if (!product.isAvailable) return;
    const customizable = !!(
      product.variants?.length ||
      product.addons?.length ||
      product.variantGroups?.length
    );
    if (customizable) return openProduct(product);
    setCart((rows) => [
      ...rows,
      { key: uid(), product, qty: 1, optionIds: [], addonIds: [], note: "" },
    ]);
  }
  async function submit() {
    if (submitting) return;
    if (!customerName.trim()) return setError("Nama customer wajib diisi.");
    if (!phoneValid) return setError("Nomor WhatsApp tidak valid.");
    if (!cart.length) return setError("Keranjang masih kosong.");
    if (isPreOrder && (!scheduleDate || !scheduleTime))
      return setError("Tanggal dan jam Pre-Order wajib dipilih.");
    setSubmitting(true);
    try {
      const result = await publicFetch<any>(
        `/public/order/${businessSlug}/${outletSlug}/orders`,
        {
          method: "POST",
          body: JSON.stringify({
            customerName,
            customerPhone,
            orderType,
            tableNumber,
            orderNote,
            isPreOrder,
            scheduledAt: isPreOrder
              ? zonedDateTimeIso(
                  scheduleDate,
                  scheduleTime,
                  meta.outlet.timezone
                )
              : null,
            customerOrderRequestId: uid(),
            items: cart.map((line) => ({
              productId: line.product.id,
              variantId: line.variantId,
              selectedVariantOptionIds: line.optionIds,
              addonIds: line.addonIds,
              qty: line.qty,
              itemNote: line.note,
            })),
          }),
        }
      );
      setCart([]);
      navigate(`/order/status/${result.publicOrderToken}`, { replace: true });
    } catch (e) {
      await refreshAvailability().catch(() => {});
      setError((e as Error).message);
      setFinalConfirm(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-ink">
      <div
        className={`mx-auto max-w-5xl ${
          !checkout && cart.length ? "pb-24 lg:pb-5" : ""
        }`}
      >
        <header className="mb-4 rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-brand-700">
            {meta?.business?.name || "FORU POS"}
          </p>
          <h1 className="text-2xl font-black">
            {meta?.outlet?.name || "Order"}
          </h1>
          <p className="text-sm text-slate-500">Pesan dulu, bayar di kasir.</p>
        </header>
        {error && (
          <div className="mb-4 rounded-2xl bg-red-50 p-3 font-semibold text-red-700">
            {error}
          </div>
        )}
        <section className="sticky top-0 z-20 mb-4 rounded-3xl bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={20}
              />
              <input
                className="input h-12 pl-12"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari menu apa?"
                type="search"
              />
            </div>
            <div className="shrink-0 rounded-2xl bg-brand-50 px-4 py-3 text-sm font-black text-brand-700">
              {filteredProducts.length} menu
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {categoryNav.map((item) => (
              <button
                key={item}
                ref={(node) => {
                  chipRefs.current[item] = node;
                }}
                type="button"
                onClick={() => scrollToCategory(item)}
                className={`shrink-0 rounded-2xl px-4 py-2 text-sm font-black shadow-sm ${
                  activeCategory === item
                    ? "bg-brand-700 text-white"
                    : "bg-slate-50 text-slate-600"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </section>
        {checkout ? (
          <section className="mx-auto max-w-2xl space-y-4 pb-28">
            <button
              onClick={() => setCheckout(false)}
              className="flex items-center gap-2 font-bold text-brand-700"
            >
              <ChevronLeft size={18} /> Tambah Pesanan
            </button>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="text-2xl font-black">Konfirmasi Pesanan</h2>
              <p className="text-slate-500">Pesanan Kamu</p>
              <div className="mt-4 space-y-3">
                {cart.map((line) => (
                  <div key={line.key} className="rounded-2xl border p-4">
                    <div className="flex justify-between gap-3">
                      <button
                        disabled={!line.product.isAvailable}
                        className="text-left disabled:cursor-not-allowed"
                        onClick={() => openProduct(line.product, line)}
                      >
                        <b>{line.product.name}</b>
                        {line.product.isAvailable ? (
                          <p className="text-xs font-semibold text-brand-700">
                            Edit variant, add-on & catatan
                          </p>
                        ) : (
                          <p className="text-xs font-black text-red-600">
                            HABIS — hapus dari pesanan
                          </p>
                        )}
                      </button>
                      <button
                        onClick={() =>
                          setCart((rows) =>
                            rows.filter((x) => x.key !== line.key)
                          )
                        }
                        className="text-red-600"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="font-bold">
                        {rupiah(
                          ((preview.subtotal || total) /
                            Math.max(itemCount, 1)) *
                            line.qty
                        )}
                      </span>
                      <div className="flex items-center rounded-xl border">
                        <button
                          onClick={() =>
                            setCart((rows) =>
                              rows.flatMap((x) =>
                                x.key === line.key
                                  ? x.qty <= 1
                                    ? []
                                    : [{ ...x, qty: x.qty - 1 }]
                                  : [x]
                              )
                            )
                          }
                          className="p-2"
                        >
                          <Minus size={16} />
                        </button>
                        <b className="px-2">{line.qty}</b>
                        <button
                          disabled={!line.product.isAvailable}
                          onClick={() =>
                            setCart((rows) =>
                              rows.map((x) =>
                                x.key === line.key
                                  ? { ...x, qty: Math.min(50, x.qty + 1) }
                                  : x
                              )
                            )
                          }
                          className="p-2 disabled:opacity-30"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                    {line.note && (
                      <p className="mt-2 text-sm text-slate-500">
                        Catatan: {line.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-2 border-t pt-4 text-sm">
                <SummaryRow
                  label="Subtotal"
                  value={preview.subtotal || total}
                />
                <SummaryRow
                  label="Diskon"
                  value={
                    preview.productDiscount +
                    preview.transactionDiscount +
                    preview.couponDiscount
                  }
                />
                <SummaryRow
                  label="Total"
                  value={preview.total || total}
                  strong
                />
              </div>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-lg font-black">Data Pemesan</h3>
              <div className="space-y-3">
                <input
                  className="input"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nama *"
                />
                <input
                  className="input"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="No. WhatsApp *"
                  inputMode="tel"
                />
                {customerPhone && !phoneValid && (
                  <p className="text-sm font-semibold text-red-600">
                    Nomor WhatsApp tidak valid.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-lg font-black">Waktu Pesanan</h3>
              <div className="grid grid-cols-2 gap-2">
                <Choice
                  active={!isPreOrder}
                  onClick={() => setIsPreOrder(false)}
                >
                  Pesan Sekarang
                </Choice>
                {meta?.outlet?.preOrderEnabled && (
                  <Choice
                    active={isPreOrder}
                    onClick={() => setIsPreOrder(true)}
                  >
                    Pre-Order
                  </Choice>
                )}
              </div>
              {isPreOrder && (
                <div className="mt-4">
                  <h4 className="mb-2 font-black">Jadwal Pesanan</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      className="input"
                      min={dateBounds.min}
                      max={dateBounds.max}
                      value={scheduleDate}
                      onChange={(e) => {
                        setScheduleDate(e.target.value);
                        setScheduleTime("");
                      }}
                    />
                    <select
                      className="input"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                    >
                      <option value="">Pilih jam *</option>
                      {slots.map((slot) => (
                        <option key={slot}>{slot}</option>
                      ))}
                    </select>
                  </div>
                  {scheduleDate && !slots.length && (
                    <p className="mt-2 text-sm font-semibold text-amber-700">
                      Outlet tutup pada tanggal yang dipilih atau seluruh slot
                      sudah lewat. Silakan pilih tanggal lain.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-lg font-black">Tipe Pesanan</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {meta?.outlet?.allowDineIn !== false && (
                  <Choice
                    active={orderType === "DINE_IN"}
                    onClick={() => setOrderType("DINE_IN")}
                  >
                    Dine In
                  </Choice>
                )}
                {meta?.outlet?.allowTakeAway !== false && (
                  <Choice
                    active={orderType === "TAKE_AWAY"}
                    onClick={() => setOrderType("TAKE_AWAY")}
                  >
                    Take Away
                  </Choice>
                )}
                {meta?.outlet?.allowDelivery && (
                  <Choice
                    active={orderType === "DELIVERY"}
                    onClick={() => setOrderType("DELIVERY")}
                  >
                    Delivery
                  </Choice>
                )}
              </div>
              {orderType === "DINE_IN" && (
                <input
                  className="input mt-3"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="Nomor meja"
                />
              )}
              <textarea
                className="input mt-3 min-h-20"
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="Catatan untuk outlet (opsional)"
              />
            </div>
            <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white p-4 shadow-2xl">
              <div className="mx-auto flex max-w-2xl items-center gap-4">
                <div className="flex-1">
                  <p className="text-xs text-slate-500">Total</p>
                  <b className="text-xl text-brand-700">
                    {rupiah(preview.total || total)}
                  </b>
                </div>
                <button
                  disabled={!formValid}
                  onClick={() => setFinalConfirm(true)}
                  className="btn btn-primary disabled:opacity-40"
                >
                  KONFIRMASI PESANAN
                </button>
              </div>
            </div>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section
              ref={productPagerRef}
              onScroll={syncCategoryFromSwipe}
              className={
                searchActive
                  ? "scroll-mt-36 space-y-6"
                  : "scroll-mt-36 flex snap-x snap-mandatory overflow-x-auto scroll-smooth overscroll-x-contain"
              }
            >
              {searchActive
                ? groupedProducts.map((group) => (
                    <CategorySection
                      key={group.id}
                      group={group}
                      setRef={(node) => {
                        sectionRefs.current[group.id] = node;
                      }}
                      addProduct={addProduct}
                    />
                  ))
                : categoryPages.map((page) => (
                    <div key={page.id} className="min-w-full snap-start pr-1">
                      <div className="space-y-6">
                        {page.groups.map((group) => (
                          <CategorySection
                            key={group.id}
                            group={group}
                            addProduct={addProduct}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              {!groupedProducts.length && (
                <div className="rounded-3xl bg-white p-8 text-center font-semibold text-slate-400 shadow-sm ring-1 ring-slate-200">
                  Menu tidak ditemukan.
                </div>
              )}
            </section>
            <aside className="rounded-3xl bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:self-start">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
                <ShoppingBag /> Pesanan ({itemCount})
              </h2>
              <div className="space-y-2">
                {cart.map((line, i) => (
                  <div key={line.key} className="rounded-2xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b>{line.product.name}</b>
                        <p className="text-sm text-slate-500">{line.qty}x</p>
                      </div>
                      <button
                        onClick={() =>
                          setCart((rows) => rows.filter((_, j) => j !== i))
                        }
                        className="text-red-600"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="my-4 border-t pt-3">
                <div className="flex justify-between text-lg font-black">
                  <span>Total</span>
                  <span className="text-brand-700">{rupiah(total)}</span>
                </div>
              </div>
              <button
                disabled={!cart.length}
                onClick={() => setCheckout(true)}
                className="btn btn-primary w-full disabled:opacity-50"
              >
                Lihat Pesanan
              </button>
            </aside>
          </div>
        )}
      </div>
      {!checkout && !!cart.length && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white p-3 shadow-2xl lg:hidden">
          <button
            onClick={() => setCheckout(true)}
            className="btn btn-primary mx-auto flex w-full max-w-2xl items-center justify-between"
          >
            <span>
              <ShoppingBag className="mr-2 inline" size={18} />
              Lihat Pesanan · {itemCount} item
            </span>
            <span>{rupiah(preview.total || total)}</span>
          </button>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 md:place-items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">{selected.name}</h2>
                <p className="text-brand-700">{rupiah(selected.basePrice)}</p>
              </div>
              <button onClick={() => setSelected(null)}>
                <X />
              </button>
            </div>
            {!!selected.variants?.length && (
              <div className="mb-4">
                <p className="mb-2 font-black">
                  Pilih Variant
                  {selected.variants.length > 1 && (
                    <span className="text-red-600"> *</span>
                  )}
                </p>
                <div className="grid gap-2">
                  {selected.variants.map((variant) => (
                    <button
                      key={variant.id}
                      onClick={() => {
                        setVariantId(variant.id);
                        setModalError("");
                      }}
                      className={`flex justify-between rounded-2xl border p-3 ${
                        variantId === variant.id
                          ? "border-brand-500 bg-brand-50"
                          : ""
                      }`}
                    >
                      <span>{variant.variantName}</span>
                      <span className="flex items-center gap-2">
                        {rupiah(variant.sellingPrice)}
                        {variantId === variant.id && <Check size={16} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {modalError && (
              <div className="mb-4 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700">
                {modalError}
              </div>
            )}
            {(selected.variantGroups || []).map((vg) => (
              <div key={vg.group.id} className="mb-4">
                <p className="mb-2 font-black">
                  {vg.group.name}
                  {vg.group.required && (
                    <span className="text-red-600"> *</span>
                  )}
                </p>
                <div className="grid gap-2">
                  {vg.group.options.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => {
                        toggleOption(vg.group, option.id);
                        setModalError("");
                      }}
                      className={`flex items-center justify-between rounded-2xl border p-3 text-left ${
                        optionIds.includes(option.id)
                          ? "border-brand-500 bg-brand-50"
                          : ""
                      }`}
                    >
                      <span>{option.name}</span>
                      <span>
                        {optionIds.includes(option.id) ? (
                          <Check size={16} />
                        ) : option.additionalPrice ? (
                          rupiah(option.additionalPrice)
                        ) : (
                          ""
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!!selected.addons?.length && (
              <div className="mb-4">
                <p className="mb-2 font-black">Add-on</p>
                <div className="grid gap-2">
                  {selected.addons.map((addon) => (
                    <button
                      key={addon.id}
                      onClick={() =>
                        setAddonIds((ids) =>
                          ids.includes(addon.id)
                            ? ids.filter((x) => x !== addon.id)
                            : [...ids, addon.id]
                        )
                      }
                      className={`flex items-center justify-between rounded-2xl border p-3 text-left ${
                        addonIds.includes(addon.id)
                          ? "border-brand-500 bg-brand-50"
                          : ""
                      }`}
                    >
                      <span>{addon.addonName}</span>
                      <span>{rupiah(addon.price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea
              className="input min-h-20"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan item (opsional)"
            />
            <div className="mt-3 flex items-center gap-3">
              <div className="flex overflow-hidden rounded-2xl border">
                <button
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                  className="grid h-12 w-12 place-items-center"
                >
                  <Minus />
                </button>
                <b className="grid h-12 w-12 place-items-center border-x">
                  {qty}
                </b>
                <button
                  onClick={() => setQty((n) => n + 1)}
                  className="grid h-12 w-12 place-items-center"
                >
                  <Plus />
                </button>
              </div>
              <button onClick={addSelected} className="btn btn-primary flex-1">
                Tambah
              </button>
            </div>
          </div>
        </div>
      )}
      {finalConfirm && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6">
            <h2 className="text-xl font-black">Kirim pesanan?</h2>
            <p className="mt-3">{itemCount} item</p>
            <b className="text-2xl text-brand-700">
              {rupiah(preview.total || total)}
            </b>
            <div className="my-4 rounded-2xl bg-slate-50 p-3 text-sm">
              <p>
                Nama: <b>{customerName}</b>
              </p>
              <p>
                {isPreOrder ? "Pre-Order • " : ""}
                {orderType.replace("_", " ")}
              </p>
              {isPreOrder && (
                <p>
                  {scheduleDate} • {scheduleTime}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={submitting}
                onClick={() => setFinalConfirm(false)}
                className="btn border"
              >
                Kembali
              </button>
              <button
                disabled={submitting}
                onClick={submit}
                className="btn btn-primary disabled:opacity-50"
              >
                {submitting ? "Mengirim..." : "Ya, Kirim Pesanan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategorySection({
  group,
  addProduct,
  setRef,
}: {
  group: {
    id: string;
    name: string;
    sortOrder: number;
    products: PublicProduct[];
  };
  addProduct: (product: PublicProduct) => void;
  setRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <section id={`category-${group.id}`} ref={setRef} className="scroll-mt-36">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="shrink-0 text-lg font-black text-slate-900">
          {group.name}
        </h2>
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-bold text-slate-400">
          {group.products.length} menu
        </span>
      </div>
      <div className="divide-y divide-slate-200 rounded-3xl bg-white px-4 shadow-sm ring-1 ring-slate-100 sm:px-5">
        {group.products.map((product) => {
          const startingPrice = product.variants?.length
            ? Math.min(
                ...product.variants.map((variant) =>
                  Number(variant.sellingPrice)
                )
              )
            : Number(product.basePrice);
          const description =
            product.description?.trim() &&
            !/^satuan\s*:/i.test(product.description.trim())
              ? product.description.trim()
              : "";
          return (
            <article
              key={product.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(112px,38%)] gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_160px] sm:gap-6"
            >
              <div className="min-w-0 self-stretch py-0.5">
                <h3 className="line-clamp-2 text-base font-black leading-snug text-slate-900 sm:text-lg">
                  {product.name}
                </h3>
                {product.isRecommended && (
                  <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">
                    REKOMENDASI
                  </span>
                )}
                {description && (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500">
                    {description}
                  </p>
                )}
                <p className="mt-3 text-base font-black text-brand-700">
                  {rupiah(startingPrice)}
                </p>
              </div>
              <div className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                  <img
                    src={imageSrc(product.imageUrl)}
                    alt={product.name}
                    loading="lazy"
                    className={`h-full w-full object-cover ${
                      product.isAvailable ? "" : "opacity-60"
                    }`}
                  />
                  {!product.isAvailable && (
                    <span className="absolute right-2 top-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white">
                      HABIS
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!product.isAvailable}
                  onClick={() => addProduct(product)}
                  className="mx-auto mt-2 flex min-h-11 w-full items-center justify-center rounded-full bg-brand-700 px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  {product.isAvailable ? "Tambah" : "Habis"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 font-bold ${
        active ? "border-brand-500 bg-brand-500 text-white" : "bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${
        strong ? "border-t pt-2 text-lg font-black" : ""
      }`}
    >
      <span>{label}</span>
      <span>{rupiah(value)}</span>
    </div>
  );
}
