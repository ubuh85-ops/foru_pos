import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  TicketPercent,
  Trash2,
  X,
} from "lucide-react";
import { API, rupiah } from "../api";
import { trackWebEvent, webAttribution } from "../webAnalytics";

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
  serviceDate?: string;
  dailyMenuScheduleId?: string;
  quotaAvailable?: number | null;
  id: string;
  name: string;
  sku?: string | null;
  category?: string;
  categoryRef?: { id: string; name: string; sortOrder?: number } | null;
  categories?: { id: string; name: string; sortOrder?: number }[];
  description?: string | null;
  imageUrl?: string | null;
  isAvailable: boolean;
  stockMode?: "UNLIMITED" | "MANUAL" | "RECIPE";
  stockQty?: number | null;
  lowStockThreshold?: number;
  stockStatus?: string;
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
const dateLabel=(date:string)=>new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00'));
function lineTotal(line:CartLine){
  const p=line.product;
  return line.qty*(Number(p.variants?.find(v=>v.id===line.variantId)?.sellingPrice??p.basePrice)+
    (p.variantGroups?.flatMap(v=>v.group.options).filter(o=>line.optionIds.includes(o.id)).reduce((sum,o)=>sum+Number(o.additionalPrice),0)||0)+
    (p.addons?.filter(a=>line.addonIds.includes(a.id)).reduce((sum,a)=>sum+Number(a.price),0)||0));
}
export default function CustomerOrderPage() {
  const { businessSlug = "", outletSlug = "" } = useParams();
  const location = useLocation();
  const trackedPage = useRef<string | null>(null);
  useEffect(() => {
    const page = `${location.key}:${businessSlug}:${outletSlug}`;
    if (!businessSlug || !outletSlug || trackedPage.current === page) return;
    trackedPage.current = page;
    trackWebEvent(businessSlug, outletSlug, 'PAGE_VIEW');
  }, [businessSlug, outletSlug, location.key]);
  const navigate = useNavigate();
  const [meta, setMeta] = useState<any>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const checkoutRequestId=useRef(uid());
  const [cartError,setCartError]=useState('');
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
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [couponApplying, setCouponApplying] = useState(false);
  const [orderType, setOrderType] = useState<Fulfillment>("DINE_IN");
  const [tableNumber, setTableNumber] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [isPreOrder, setIsPreOrder] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [availableDates,setAvailableDates]=useState<string[]>([]);
  const [menuLoading,setMenuLoading]=useState(false);
  const requestVersion=useRef(0);
  const savedCarts=useRef<{normal:CartLine[];preorder:CartLine[]}>({normal:[],preorder:[]});
  const sortedCart=[...cart].sort((a,b)=>(a.product.serviceDate||'').localeCompare(b.product.serviceDate||''));
  function switchMode(next:boolean){
    savedCarts.current[isPreOrder?'preorder':'normal']=cart;
    setCart(savedCarts.current[next?'preorder':'normal']);
    setIsPreOrder(next);setSelected(null);setCheckout(false);setCouponCode('');setProducts([]);setError('');
  }
  function dateGroup(line:CartLine,index:number){
    const date=line.product.serviceDate;
    return date&&sortedCart[index-1]?.product.serviceDate!==date?<div className="mb-3 border-b border-violet-200 pb-2 text-violet-800"><b>📅 {dateLabel(date)}</b><p className="text-sm">Subtotal {rupiah(cart.filter(row=>row.product.serviceDate===date).reduce((sum,row)=>sum+lineTotal(row),0))}</p></div>:null;
  }
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
    const version=++requestVersion.current;
    const info=await publicFetch<any>(`/public/order/${businessSlug}/${outletSlug}`);
    if(version!==requestVersion.current)return {info,rows:[]};
    setMeta(info);
    const daily=info.outlet.webOrderMode==='PREORDER_ONLY'||(isPreOrder&&info.outlet.webOrderMode==='NORMAL_AND_PREORDER'&&info.outlet.preOrderEnabled);
    if(daily!==isPreOrder){setIsPreOrder(daily);setProducts([]);setCart([]);return {info,rows:[]};}
    let date=scheduleDate;
    if(daily){
      const dates=await publicFetch<string[]>(`/public/order/${businessSlug}/${outletSlug}/preorder/dates`);
      if(version!==requestVersion.current)return {info,rows:[]};
      setAvailableDates(dates);
      if(!dates.includes(date)){date=dates[0]||'';setScheduleDate(date);}
    }
    const rows=daily&&!date?[]:await publicFetch<PublicProduct[]>(`/public/order/${businessSlug}/${outletSlug}/${daily?'preorder/menu?date='+date:'products'}`);
    if(version!==requestVersion.current)return {info,rows};
    setProducts(rows);
    const latest=new Map(rows.map(product=>[product.dailyMenuScheduleId||product.id,product]));
    setCart(current=>current.map(line=>{
      if(daily&&line.product.serviceDate!==date)return line;
      const product=latest.get(line.product.dailyMenuScheduleId||line.product.id);
      return {...line,product:product||{...line.product,isAvailable:false}};
    }));
    return {info,rows};
  }
  useEffect(()=>{
    setMenuLoading(true);setProducts([]);
    const refresh=()=>refreshAvailability().then(({info})=>{
      if(!info.outlet?.allowDineIn&&info.outlet?.allowTakeAway)setOrderType('TAKE_AWAY');
    }).catch(e=>setError((e as Error).message)).finally(()=>setMenuLoading(false));
    void refresh();
    const timer=window.setInterval(refresh,10000);
    const focus=()=>{if(!document.hidden)void refresh();};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return ()=>{requestVersion.current++;window.clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[businessSlug,outletSlug,isPreOrder,scheduleDate]);

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
  const displayTotal = cart.length && preview.subtotal > 0 ? preview.total : total;
  const storeOpen = !!meta?.outlet?.enabled && meta?.outlet?.acceptingCustomerOrders !== false;
  const phoneValid = /^\+?[0-9][0-9\s-]{7,19}$/.test(customerPhone.trim());
  const formValid =
    storeOpen && !cartError && !!cart.length &&
    cart.every((line) => line.product.isAvailable) &&
    customerName.trim().length >= 2 &&
    phoneValid &&
    (!isPreOrder || cart.every(line=>!!line.product.serviceDate));
  function publicOrderItems() {
    return cart.map((line) => ({
      serviceDate: line.product.serviceDate,
      dailyMenuScheduleId: line.product.dailyMenuScheduleId,
      productId: line.product.id,
      variantId: line.variantId,
      selectedVariantOptionIds: line.optionIds,
      addonIds: line.addonIds,
      qty: line.qty,
      itemNote: line.note,
    }));
  }

  async function loadPreview(code = couponCode) {
    return publicFetch<any>(
      `/public/order/${businessSlug}/${outletSlug}/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          orderMode: isPreOrder?'PREORDER':'NORMAL',
          items: publicOrderItems(),
          couponCode: code || undefined,
        }),
      }
    );
  }

  useEffect(() => {
    let active=true;
    if (!cart.length){setCartError('');setPreview({
        subtotal: 0,
        productDiscount: 0,
        transactionDiscount: 0,
        couponDiscount: 0,
        total: 0,
      });return;}
    const timer = window.setTimeout(
      () =>
        loadPreview()
          .then(result=>{if(active){setPreview(result);setCartError('');}})
          .catch((previewError) => {
            if(!active)return;
            setCartError((previewError as Error).message);
            if (couponCode) {
              setCouponCode("");
              setCouponMessage((previewError as Error).message);
            }
            setPreview((p) => ({ ...p, subtotal: total, total }));
          }),
      150
    );
    return () => {active=false;window.clearTimeout(timer);};
  }, [cart, total, businessSlug, outletSlug, couponCode]);
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      return (
        !q ||
        [
          product.name,
          product.sku,
          product.categoryRef?.name,
          ...(product.categories || []).map(category => category.name),
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
      const assigned = product.categories?.length
        ? product.categories
        : [{ id: product.categoryRef?.id || product.category || "uncategorized", name: product.categoryRef?.name || product.category || "Menu", sortOrder: product.categoryRef?.sortOrder }];
      for (const category of assigned) {
        if (!map.has(category.id))
          map.set(category.id, {
            id: category.id,
            name: category.name,
            sortOrder: Number(category.sortOrder ?? 0),
            products: [],
          });
        map.get(category.id)!.products.push(product);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );
  }, [filteredProducts]);
  const primaryGroupedProducts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; sortOrder: number; products: PublicProduct[] }>();
    for (const product of filteredProducts) {
      const category = product.categories?.[0] || { id: product.categoryRef?.id || product.category || "uncategorized", name: product.categoryRef?.name || product.category || "Menu", sortOrder: product.categoryRef?.sortOrder };
      if (!map.has(category.id)) map.set(category.id, { id: category.id, name: category.name, sortOrder: Number(category.sortOrder ?? 0), products: [] });
      map.get(category.id)!.products.push(product);
    }
    return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
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
          ? [recommendationGroup, ...primaryGroupedProducts]
          : primaryGroupedProducts,
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
    [groupedProducts, primaryGroupedProducts, recommendationGroup]
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
    if(selected.quotaAvailable!=null&&qty+cart.filter(line=>line.key!==editingKey&&line.product.dailyMenuScheduleId===selected.dailyMenuScheduleId).reduce((sum,line)=>sum+line.qty,0)>selected.quotaAvailable){setModalError('Jumlah melebihi kuota tanggal ini.');return;}
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
    if (!editingKey || qty > (cart.find(line => line.key === editingKey)?.qty ?? qty)) {
      trackWebEvent(businessSlug, outletSlug, 'ADD_TO_CART', selected.id);
    }
    setSelected(null);
    setEditingKey(null);
    setModalError("");
  }
  function addProduct(product: PublicProduct) {
    if (!storeOpen || !product.isAvailable) return;
    const customizable = !!(
      product.variants?.length ||
      product.addons?.length ||
      product.variantGroups?.length
    );
    if(product.quotaAvailable!=null&&cart.filter(line=>line.product.dailyMenuScheduleId===product.dailyMenuScheduleId).reduce((sum,line)=>sum+line.qty,0)>=product.quotaAvailable){setError('Jumlah melebihi kuota tanggal ini.');return;}
    if (customizable) return openProduct(product);
    trackWebEvent(businessSlug, outletSlug, 'ADD_TO_CART', product.id);
    setCart((rows) => [
      ...rows,
      { key: uid(), product, qty: 1, optionIds: [], addonIds: [], note: "" },
    ]);
  }
  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return setCouponMessage("Masukkan kode kupon terlebih dahulu.");
    if (!cart.length) return setCouponMessage("Keranjang masih kosong.");
    setCouponApplying(true);
    setCouponMessage("");
    try {
      const result = await loadPreview(code);
      const appliedCode = String(result.coupon?.code || code).toUpperCase();
      setCouponInput(appliedCode);
      setCouponCode(appliedCode);
      setPreview(result);
      setCouponMessage(
        `${result.coupon?.name || "Kupon"} berhasil diterapkan.`
      );
    } catch (couponError) {
      setCouponCode("");
      setCouponMessage((couponError as Error).message);
    } finally {
      setCouponApplying(false);
    }
  }
  function removeCoupon() {
    setCouponInput("");
    setCouponCode("");
    setCouponMessage("");
  }
  async function submit() {
    if (submitting) return;
    if (!storeOpen) return setError("Toko sedang tutup sementara.");
    if (!customerName.trim()) return setError("Nama customer wajib diisi.");
    if (!phoneValid) return setError("Nomor WhatsApp tidak valid.");
    if (!cart.length) return setError("Keranjang masih kosong.");
    if (isPreOrder && cart.some(line=>!line.product.serviceDate))
      return setError("Tanggal Pre-Order wajib dipilih.");
    setSubmitting(true);
    try {
      const result = await publicFetch<any>(
        `/public/order/${businessSlug}/${outletSlug}/orders`,
        {
          method: "POST",
          body: JSON.stringify({
            customerName,
            analytics: webAttribution(businessSlug, outletSlug),
            customerPhone,
            orderType,
            tableNumber,
            orderNote,
            couponCode: couponCode || undefined,
            isPreOrder,
            orderMode: isPreOrder?'PREORDER':'NORMAL',
            scheduledAt: null,
            customerOrderRequestId: checkoutRequestId.current,
            items: publicOrderItems(),
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
        {meta?.outlet?.webOrderMode==='NORMAL_AND_PREORDER'&&meta?.outlet?.preOrderEnabled&&<div className="mb-4 grid grid-cols-2 gap-2"><Choice active={!isPreOrder} onClick={()=>switchMode(false)}>Pesan Sekarang</Choice><Choice active={isPreOrder} onClick={()=>switchMode(true)}>Pre-Order</Choice></div>}
        {cartError&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">{cartError}</p>}
        {error && (
          <div className="mb-4 rounded-2xl bg-red-50 p-3 font-semibold text-red-700">
            {error}
          </div>
        )}
        {meta && !storeOpen && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-amber-800">
            <b className="block text-lg">Toko sedang tutup sementara</b>
            <p className="mt-1 text-sm">Menu tetap dapat dilihat, tetapi pesanan baru belum dapat dibuat.</p>
          </div>
        )}
        <section className="sticky top-0 z-20 mb-4 rounded-3xl bg-white/95 p-4 shadow-sm backdrop-blur">
          {isPreOrder&&<div className="mb-3 border-b pb-3"><p className="text-xs font-black uppercase text-violet-700">Daily Menu Pre-Order</p><h2 className="font-black">{scheduleDate?dateLabel(scheduleDate):'Belum ada tanggal tersedia'}</h2><p className="text-xs text-slate-500">Pilih produk apa saja. Boleh pesan hanya pada tanggal tertentu.</p><div className="mt-3 flex gap-2 overflow-x-auto pb-2">{availableDates.map(date=><button key={date} aria-pressed={date===scheduleDate} onClick={()=>{setScheduleDate(date);setProducts([]);setSelected(null);}} className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold ${date===scheduleDate?'bg-violet-700 text-white':'bg-white'}`}>{dateLabel(date)}</button>)}</div></div>}
          {menuLoading&&<p role="status">Memuat menu…</p>}
          {!menuLoading&&isPreOrder&&!products.length&&<p className="text-sm text-slate-500">Belum ada menu yang bisa dipesan. Jadwal mungkin ditutup atau kuota habis.</p>}
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
                {sortedCart.map((line, index) => (
                  <div key={line.key} className="rounded-2xl border p-4">
                    {dateGroup(line,index)}
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
                        {rupiah(lineTotal(line))}
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
                          onClick={() => {
                            if(line.product.quotaAvailable!=null&&cart.filter(row=>row.product.dailyMenuScheduleId===line.product.dailyMenuScheduleId).reduce((sum,row)=>sum+row.qty,0)>=line.product.quotaAvailable)return;
                            const maxQty=line.product.stockMode==='MANUAL'?Math.min(50,line.product.stockQty??0):50;
                            if (line.qty < maxQty) trackWebEvent(businessSlug, outletSlug, 'ADD_TO_CART', line.product.id);
                            setCart((rows) =>
                              rows.map((x) =>
                                x.key === line.key
                                  ? { ...x, qty: Math.min(maxQty, x.qty + 1) }
                                  : x
                              )
                            );
                          }}
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
                    preview.transactionDiscount
                  }
                />
                {(couponCode || preview.couponDiscount > 0) && (
                  <SummaryRow
                    label={`Kupon${couponCode ? ` (${couponCode})` : ""}`}
                    value={preview.couponDiscount}
                  />
                )}
                <SummaryRow
                  label="Total"
                  value={displayTotal}
                  strong
                />
              </div>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <TicketPercent className="text-brand-700" size={20} />
                <h3 className="text-lg font-black">Kupon / Voucher</h3>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void applyCoupon();
                }}
              >
                <input
                  className="input min-w-0 uppercase"
                  value={couponInput}
                  onChange={(event) => {
                    const next = event.target.value.toUpperCase();
                    setCouponInput(next);
                    if (couponCode && next !== couponCode) {
                      setCouponCode("");
                      setCouponMessage("");
                    }
                  }}
                  placeholder="Masukkan kode kupon"
                  maxLength={50}
                  autoCapitalize="characters"
                />
                <button
                  type="submit"
                  disabled={couponApplying || !couponInput.trim() || !cart.length}
                  className="btn btn-primary shrink-0 disabled:opacity-50"
                >
                  {couponApplying ? "Cek..." : "Terapkan"}
                </button>
              </form>
              {couponMessage && (
                <div
                  className={`mt-3 flex items-start justify-between gap-3 rounded-2xl px-3 py-2 text-sm font-semibold ${
                    couponCode
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  <span className="flex items-start gap-2">
                    {couponCode && <Check className="mt-0.5 shrink-0" size={16} />}
                    {couponMessage}
                  </span>
                  {couponCode && (
                    <button
                      type="button"
                      onClick={removeCoupon}
                      aria-label="Hapus kupon"
                      className="shrink-0 rounded-lg p-1 hover:bg-white/70"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              )}
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
                    {rupiah(displayTotal)}
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
                      storeOpen={storeOpen}
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
                            storeOpen={storeOpen}
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
                {sortedCart.map((line, i) => (
                  <div key={line.key} className="rounded-2xl border p-3">
                    {dateGroup(line,i)}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b>{line.product.name}</b>
                        <p className="text-sm text-slate-500">{line.qty}x</p>
                      </div>
                      <button
                        onClick={() =>
                          setCart((rows) => rows.filter(row => row.key !== line.key))
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
                disabled={!storeOpen || !cart.length}
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
            disabled={!storeOpen}
            onClick={() => setCheckout(true)}
            className="btn btn-primary mx-auto flex w-full max-w-2xl items-center justify-between disabled:opacity-40"
          >
            <span>
              <ShoppingBag className="mr-2 inline" size={18} />
              Lihat Pesanan · {itemCount} item
            </span>
            <span>{rupiah(displayTotal)}</span>
          </button>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 md:place-items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">{selected.serviceDate&&<span className="block text-sm text-violet-700">📅 {dateLabel(selected.serviceDate)}</span>}{selected.name}</h2>
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
              <button disabled={!storeOpen} onClick={addSelected} className="btn btn-primary flex-1 disabled:opacity-40">
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
              {rupiah(displayTotal)}
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
                  {[...new Set(cart.map(line=>line.product.serviceDate).filter(Boolean))].map(date=><span className="block" key={date}>{dateLabel(date!)}</span>)}
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
                disabled={submitting || !formValid}
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
  storeOpen,
  setRef,
}: {
  group: {
    id: string;
    name: string;
    sortOrder: number;
    products: PublicProduct[];
  };
  addProduct: (product: PublicProduct) => void;
  storeOpen: boolean;
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
                {product.quotaAvailable!=null&&<p className="mt-1 text-xs font-bold text-violet-700">Sisa kuota {product.quotaAvailable}</p>}
              </div>
              <div className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                  <img
                    src="/images/foru.png"
                    alt=""
                    className="absolute inset-0 m-auto h-20 w-20 object-contain opacity-60"
                  />
                  {product.imageUrl && (
                    <img
                      src={imageSrc(product.imageUrl)}
                      alt=""
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                      className={`absolute inset-0 h-full w-full object-cover ${
                        product.isAvailable ? "" : "opacity-60"
                      }`}
                    />
                  )}
                  {!product.isAvailable && (
                    <span className="absolute right-2 top-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white">
                      HABIS
                    </span>
                  )}
                  {product.isAvailable && product.stockStatus === "LOW_STOCK" && (
                    <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-black text-white">
                      MAU HABIS{product.stockQty == null ? "" : ` · ${product.stockQty}`}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!storeOpen || !product.isAvailable}
                  onClick={() => addProduct(product)}
                  className="mx-auto mt-2 flex min-h-11 w-full items-center justify-center rounded-full bg-brand-700 px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  {!storeOpen ? "Tutup" : product.isAvailable ? "Tambah" : "Habis"}
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
