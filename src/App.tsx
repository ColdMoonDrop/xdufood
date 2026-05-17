import { useEffect, useMemo, useState } from "react";
import {
  Bike,
  Building2,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Leaf,
  MapPin,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  Utensils,
  X,
} from "lucide-react";
import { foodCatalog, officialCanteenAreas } from "./data/catalog";
import { applyCatalogPatch } from "./data/catalogPatch";
import { loadCatalogPatch } from "./data/catalogPatchApi";
import {
  exportSubmissions,
  loadServerSubmissions,
  loadStudentSubmissions,
  makeSubmissionId,
  saveStudentSubmissions,
  submitStudentSubmission,
} from "./data/studentSubmissions";
import type { StudentSubmission, StudentSubmissionKind, SubmissionAttachment } from "./domain/feedback";
import {
  campusLabels,
  channelLabels,
  foodTypeLabels,
  mealPeriodLabels,
  vendorChannels,
  type Campus,
  type Channel,
  type FoodItem,
  type FoodType,
  type FoodVendor,
  type MealPeriod,
  type StudentPreference,
} from "./domain/food";
import { recommendFood } from "./recommendation/recommender";

const recentStorageKey = "xdu-food-recent-items-v1";

type PrimaryTypeChoice = "any" | "rice" | "noodle" | "snack" | "western" | "drink";
type FlavorTypeChoice = "any" | "light" | "spicy";

const primaryFoodTypeOptions: FoodType[] = ["rice", "noodle", "snack", "western", "drink"];
const flavorFoodTypeOptions: FoodType[] = ["light", "spicy"];

const primaryTypeOptions: Array<{ value: PrimaryTypeChoice; label: string }> = [
  { value: "any", label: "都可以" },
  { value: "rice", label: foodTypeLabels.rice },
  { value: "noodle", label: foodTypeLabels.noodle },
  { value: "snack", label: foodTypeLabels.snack },
  { value: "western", label: foodTypeLabels.western },
  { value: "drink", label: foodTypeLabels.drink },
];

const flavorTypeOptions: Array<{ value: FlavorTypeChoice; label: string }> = [
  { value: "any", label: "都可" },
  { value: "light", label: "清淡" },
  { value: "spicy", label: "重口" },
];

const extraTypeOptions: FoodType[] = ["protein", "local"];

const defaultPreference: StudentPreference = {
  campus: "south",
  budget: 18,
  mealPeriod: "lunch",
  selectedChannels: ["canteen", "nearby", "delivery"],
  canteenAreas: [],
  wantedTypes: [],
  avoidTypes: [],
  heat: "any",
  needVegetarian: false,
  needHalal: false,
};

const diningModeOptions = [
  { id: "dine-in", label: "堂食", channels: ["canteen", "nearby"] },
  { id: "delivery", label: "外卖", channels: ["delivery"] },
] satisfies Array<{ id: string; label: string; channels: Channel[] }>;

const communityAreaPresets = ["老综", "新综", "家属区"];
const defaultCommunityChannels: Channel[] = ["nearby", "delivery"];
const maxSubmissionPhotos = 3;
const adminHref = `${import.meta.env.BASE_URL}admin`;

function App() {
  const [preference, setPreference] = useState<StudentPreference>(defaultPreference);
  const [randomnessSeed, setRandomnessSeed] = useState(() => Number(window.localStorage.getItem("xdu-food-seed")) || Date.now());
  const [recentItemIds, setRecentItemIds] = useState<string[]>(() => loadRecentItems());
  const [submissions, setSubmissions] = useState<StudentSubmission[]>(() => loadStudentSubmissions());
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);
  const [showReviewQueue, setShowReviewQueue] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState("");
  const [serverQueueOnline, setServerQueueOnline] = useState(false);
  const [catalog, setCatalog] = useState(foodCatalog);
  const [catalogPatchOnline, setCatalogPatchOnline] = useState(false);

  const activePreference = useMemo(
    () => ({ ...preference, randomnessSeed, recentItemIds }),
    [preference, randomnessSeed, recentItemIds],
  );
  const recommendations = useMemo(() => recommendFood(catalog, activePreference), [activePreference, catalog]);
  const top = recommendations[0];
  const topLocation = top
    ? top.vendor.locationHint ??
      [top.vendor.area, top.vendor.floor, top.vendor.windowNo ? `${top.vendor.windowNo}号窗口` : "", top.vendor.windowName]
        .filter(Boolean)
        .join(" · ")
    : "";
  const dineInAreaOptions = useMemo(() => {
    const realAreas = officialCanteenAreas
      .filter((source) => source.campus === preference.campus)
      .map((source) => source.area);
    const communityAreas = preference.campus === "south" ? communityAreaPresets : [];

    return Array.from(new Set([...realAreas, ...communityAreas]));
  }, [preference.campus]);
  const isDineInSelected = preference.selectedChannels.some((channel) => channel === "canteen" || channel === "nearby");
  const selectedAreaSource = useMemo(() => {
    return (
      officialCanteenAreas.find(
        (source) => source.campus === preference.campus && preference.canteenAreas.includes(source.area),
      ) ?? null
    );
  }, [preference.campus, preference.canteenAreas]);
  const selectedAreaCatalogStats = useMemo(() => {
    if (!selectedAreaSource) return null;
    const vendors = catalog.filter(
      (vendor) =>
        vendor.campus === preference.campus &&
        vendor.channel === "canteen" &&
        vendor.area === selectedAreaSource.area,
    );
    return {
      vendorCount: vendors.length,
      itemCount: vendors.reduce((sum, vendor) => sum + vendor.items.length, 0),
      imageCount: selectedAreaSource.imageCount,
    };
  }, [catalog, preference.campus, selectedAreaSource]);
  useEffect(() => {
    let cancelled = false;
    loadServerSubmissions()
      .then((serverSubmissions) => {
        if (cancelled) return;
        setServerQueueOnline(true);
        setSubmissions(serverSubmissions);
        saveStudentSubmissions(serverSubmissions);
      })
      .catch(() => {
        if (!cancelled) setServerQueueOnline(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCatalogPatch()
      .then((patch) => {
        if (cancelled) return;
        setCatalog(applyCatalogPatch(foodCatalog, patch));
        setCatalogPatchOnline(true);
      })
      .catch(() => {
        if (!cancelled) setCatalogPatchOnline(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function reshuffleRecommendations() {
    const nextSeed = Date.now();
    window.localStorage.setItem("xdu-food-seed", String(nextSeed));
    setRandomnessSeed(nextSeed);
  }

  function rememberChoice(target = top) {
    if (!target) return;
    const key = choiceKey(target.vendor.id, target.item.id);
    const next = [key, ...recentItemIds.filter((item) => item !== key)].slice(0, 20);
    window.localStorage.setItem(recentStorageKey, JSON.stringify(next));
    setRecentItemIds(next);
    reshuffleRecommendations();
  }

  async function addSubmission(submission: StudentSubmission) {
    try {
      const saved = await submitStudentSubmission(submission);
      const next = [saved, ...submissions.filter((current) => current.id !== saved.id)];
      setServerQueueOnline(true);
      setSubmissions(next);
      saveStudentSubmissions(next);
      setFeedbackTarget(null);
      setSubmissionNotice("已提交到手机服务器审核队列，审核通过后再更新商家和菜品。");
    } catch {
      const next = [submission, ...submissions];
      setServerQueueOnline(false);
      setSubmissions(next);
      saveStudentSubmissions(next);
      setFeedbackTarget(null);
      setSubmissionNotice("服务器暂时不可用，已先保存在本机浏览器队列。");
    }
  }

  function clearSubmissions() {
    setSubmissions([]);
    saveStudentSubmissions([]);
    setSubmissionNotice("审核队列已清空。");
  }

  return (
    <main className="appShell">
      <section className="controlRail" aria-label="推荐偏好">
        <div className="brandBlock">
          <div className="brandMark">
            <Utensils size={22} />
          </div>
          <div>
            <p className="eyebrow">XDU FOOD ORACLE</p>
            <h1>西电今天吃什么</h1>
          </div>
        </div>

        <section className="quickPickCard" aria-label="当前推荐">
          <div className="quickPickHeader">
            <span>当前推荐</span>
            <strong>{recommendations.length > 0 ? `${recommendations.length} 个可选` : "暂无结果"}</strong>
          </div>
          {top ? (
            <>
              <h2>{top.item.name}</h2>
              <p>{top.vendor.name}</p>
              <div className="quickPickMeta">
                <span>{formatChannelList(top.vendor)}</span>
                <span>{topLocation}</span>
              </div>
              <div className="quickPickActions">
                <button onClick={reshuffleRecommendations}>
                  <Shuffle size={16} />
                  换一批
                </button>
                <button onClick={() => rememberChoice()}>
                  <Check size={16} />
                  吃这个
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>暂时没有合适餐品</h2>
              <p>放宽主类别、换餐别，或选择有正文菜单的堂食地点。</p>
              <div className="quickPickActions single">
                <button onClick={() => setPreference(defaultPreference)}>
                  <RotateCcw size={16} />
                  重置筛选
                </button>
              </div>
            </>
          )}
        </section>

        <div className="quickTools" aria-label="菜单共建工具">
          <button
            onClick={() =>
              setFeedbackTarget({
                mode: "new-vendor",
                areaPreset: "老综",
                supportedChannels: defaultCommunityChannels,
              })
            }
          >
            <Plus size={16} />
            补充
          </button>
          <button onClick={() => setShowReviewQueue((current) => !current)}>
            <Download size={16} />
            {showReviewQueue ? "收起" : "记录"}
          </button>
          <a className="quickToolLink" href={adminHref}>
            后台
          </a>
        </div>
        <p className="railStatus">
          {serverQueueOnline ? "手机服务器在线" : "本机缓存模式"} · {catalogPatchOnline ? "在线修订已加载" : "静态菜单"}
        </p>

        <div className="fieldGroup">
          <div className="fieldHeader">
            <MapPin size={17} />
            <span>校区</span>
          </div>
          <div className="segmented two">
            {(["south", "north"] satisfies Campus[]).map((campus) => (
              <button
                key={campus}
                className={preference.campus === campus ? "active" : ""}
                onClick={() => setPreference((current) => ({ ...current, campus, canteenAreas: [] }))}
              >
                {campusLabels[campus]}
              </button>
            ))}
          </div>
        </div>

        <div className="fieldGroup">
          <div className="fieldHeader">
            <Clock3 size={17} />
            <span>餐别</span>
          </div>
          <div className="segmented grid">
            {(["breakfast", "lunch", "dinner", "late"] satisfies MealPeriod[]).map((period) => (
              <button
                key={period}
                className={preference.mealPeriod === period ? "active" : ""}
                onClick={() => setPreference((current) => ({ ...current, mealPeriod: period }))}
              >
                {mealPeriodLabels[period]}
              </button>
            ))}
          </div>
        </div>

        <div className="fieldGroup">
          <div className="fieldHeader">
            <SlidersHorizontal size={17} />
            <span>方式</span>
          </div>
          <div className="segmented two">
            {diningModeOptions.map((mode) => (
              <button
                key={mode.id}
                className={isDiningModeActive(preference, mode.channels) ? "active" : ""}
                onClick={() => setPreference((current) => toggleDiningMode(current, mode.channels))}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {isDineInSelected ? (
          <div className="fieldGroup">
            <div className="fieldHeader">
              <Building2 size={17} />
              <span>堂食地点</span>
            </div>
            <div className="chipGrid">
              <button
                className={preference.canteenAreas.length === 0 ? "chip active" : "chip"}
                onClick={() => setPreference((current) => ({ ...current, canteenAreas: [] }))}
              >
                全部堂食地点
              </button>
              {dineInAreaOptions.map((area) => (
                <button
                  key={area}
                  className={preference.canteenAreas.includes(area) ? "chip active" : "chip"}
                  onClick={() => setPreference((current) => toggleCanteenArea(current, area))}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="fieldGroup">
          <div className="fieldHeader">
            <Sparkles size={17} />
            <span>想吃</span>
          </div>
          <div className="preferenceStack">
            <div className="preferenceBlock">
              <div className="subFieldLabel">主类别</div>
              <div className="segmented grid primaryTypeGrid">
                {primaryTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={getPrimaryType(preference) === option.value ? "active" : ""}
                    onClick={() => setPreference((current) => setPrimaryType(current, option.value))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="preferenceBlock">
              <div className="subFieldLabel">口味倾向</div>
              <div className="segmented three">
                {flavorTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={getFlavorType(preference) === option.value ? "active" : ""}
                    onClick={() => setPreference((current) => setFlavorType(current, option.value))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="preferenceBlock">
              <div className="subFieldLabel">加分偏好</div>
              <div className="chipGrid">
                {extraTypeOptions.map((type) => (
                  <button
                    key={type}
                    className={preference.wantedTypes.includes(type) ? "chip active" : "chip"}
                    onClick={() => setPreference((current) => toggleWantedType(current, type))}
                  >
                    {foodTypeLabels[type]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="fieldGroup compactPair">
          <label className="toggleLine">
            <input
              type="checkbox"
              checked={preference.needVegetarian}
              onChange={(event) =>
                setPreference((current) => ({
                  ...current,
                  needVegetarian: event.target.checked,
                  wantedTypes: current.wantedTypes.filter((type) => type !== "vegetarian"),
                }))
              }
            />
            <Leaf size={17} />
            <span>素食</span>
          </label>
          <label className="toggleLine">
            <input
              type="checkbox"
              checked={preference.needHalal}
              onChange={(event) =>
                setPreference((current) => ({
                  ...current,
                  needHalal: event.target.checked,
                  wantedTypes: current.wantedTypes.filter((type) => type !== "halal"),
                }))
              }
            />
            <ShieldCheck size={17} />
            <span>清真</span>
          </label>
        </div>

        <button className="resetButton" onClick={() => setPreference(defaultPreference)}>
          <RotateCcw size={17} />
          重置
        </button>
      </section>

      <section className="resultStage">
        <header className="resultHeader">
          <div>
            <p className="eyebrow">更多选择</p>
            <h2>推荐列表</h2>
          </div>
          <span>
            {campusLabels[preference.campus]} · {mealPeriodLabels[preference.mealPeriod]} · 公众号正文菜单
          </span>
        </header>

        {showReviewQueue ? (
          <SubmissionQueue
            submissions={submissions}
            onExport={() => exportSubmissions(submissions)}
            onClear={clearSubmissions}
          />
        ) : null}

        {selectedAreaSource ? (
          <section className="dataNotice" aria-label="堂食数据状态">
            <Building2 size={18} />
            <span>
              {selectedAreaSource.area} 已接入公众号正文菜单；当前可推荐{" "}
              {selectedAreaCatalogStats?.vendorCount ?? 0} 个窗口 / {selectedAreaCatalogStats?.itemCount ?? 0} 道菜。
              历史价格暂不展示，现况可由学生补照片校准。
            </span>
            <a href={selectedAreaSource.sourceUrl} target="_blank" rel="noreferrer">
              查看来源
            </a>
            <button
              type="button"
              onClick={() =>
                setFeedbackTarget({
                  mode: "new-vendor",
                  areaPreset: selectedAreaSource.area,
                  supportedChannels: ["canteen"],
                })
              }
            >
              补充菜单照片
            </button>
          </section>
        ) : null}

        <section className="recommendationGrid" aria-label="推荐列表">
          {recommendations.map((result, index) => (
            <article className={index === 0 ? "foodCard primary" : "foodCard"} key={`${result.vendor.id}-${result.item.id}`}>
              <div className="cardTop">
                <div>
                  <span className="rank">#{index + 1}</span>
                  <h3>{result.item.name}</h3>
                  <p>{result.vendor.name}</p>
                </div>
                <div className="scoreBadge">{result.score}</div>
              </div>
              {result.item.reviewStatus === "pending" ? <span className="betaPill">正文待校准</span> : null}

              <div className="metaLine">
                <span>
                  {vendorChannels(result.vendor).includes("delivery") ? <Bike size={15} /> : <Building2 size={15} />}
                  {formatChannelList(result.vendor)}
                </span>
                <span>
                  <MapPin size={15} />
                  {result.vendor.locationHint ?? result.vendor.area}
                </span>
                {typeof result.vendor.rating === "number" ? (
                  <span>
                    <Star size={15} />
                    {result.vendor.rating}
                  </span>
                ) : null}
              </div>

              <p className="description">{result.item.description}</p>

              <div className="reasonList">
                {result.reasons.map((reason) => (
                  <span key={reason}>
                    <Check size={14} />
                    {reason}
                  </span>
                ))}
              </div>

              <div className="tagRow">
                {result.item.types.slice(0, 4).map((type) => (
                  <span key={type}>{foodTypeLabels[type]}</span>
                ))}
              </div>

              <div className="cardFooter">
              <span>
                {result.vendor.locationHint ??
                    [
                      result.vendor.area,
                      result.vendor.floor,
                      result.vendor.windowNo ? `${result.vendor.windowNo}号窗口` : "",
                      result.vendor.windowName,
                    ]
                      .filter(Boolean)
                      .join(" · ")} · {formatChannelList(result.vendor)} · {result.vendor.source}
                  {result.vendor.updatedAt ? ` · ${result.vendor.updatedAt}` : ""}
                </span>
                {result.vendor.sourceUrl ? (
                  <a
                    className="sourceButton"
                    aria-label={`查看 ${result.item.name} 来源`}
                    href={result.vendor.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ChevronRight size={18} />
                  </a>
                ) : (
                  <button aria-label={`查看 ${result.item.name}`}>
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>
              <div className="feedbackActions">
                <button onClick={() => setFeedbackTarget({ mode: "correction", vendor: result.vendor, item: result.item })}>
                  <MessageSquarePlus size={15} />
                  纠错
                </button>
                <button onClick={() => rememberChoice(result)}>
                  <Check size={15} />
                  记为吃过
                </button>
              </div>
            </article>
          ))}
        </section>

      </section>
      {feedbackTarget ? (
        <FeedbackPanel
          campus={preference.campus}
          target={feedbackTarget}
          locationOptions={dineInAreaOptions}
          onClose={() => setFeedbackTarget(null)}
          onSubmit={addSubmission}
        />
      ) : null}
      {submissionNotice ? <div className="toastMessage">{submissionNotice}</div> : null}
    </main>
  );
}

interface FeedbackTarget {
  mode: "correction" | "new-vendor";
  vendor?: FoodVendor;
  item?: FoodItem;
  areaPreset?: string;
  supportedChannels?: Channel[];
}

function FeedbackPanel({
  campus,
  target,
  locationOptions,
  onClose,
  onSubmit,
}: {
  campus: Campus;
  target: FeedbackTarget;
  locationOptions: string[];
  onClose: () => void;
  onSubmit: (submission: StudentSubmission) => void;
}) {
  const vendor = target.vendor;
  const item = target.item;
  const initialSupportedChannels = target.supportedChannels ?? (vendor ? vendorChannels(vendor) : defaultCommunityChannels);
  const [kind, setKind] = useState<StudentSubmissionKind>(target.mode === "new-vendor" ? "new-vendor" : "correction");
  const [vendorName, setVendorName] = useState(vendor?.name ?? "");
  const [area, setArea] = useState(vendor?.area ?? target.areaPreset ?? locationOptions[0] ?? "老综");
  const [floor, setFloor] = useState(vendor?.floor ?? "");
  const [windowNo, setWindowNo] = useState(vendor?.windowNo ?? "");
  const [dishName, setDishName] = useState(item?.name ?? "");
  const [tags, setTags] = useState(item?.types.map((type) => foodTypeLabels[type]).join("、") ?? "");
  const [supportedChannels, setSupportedChannels] = useState<Channel[]>(initialSupportedChannels);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [attachments, setAttachments] = useState<SubmissionAttachment[]>([]);
  const [photoStatus, setPhotoStatus] = useState("");
  const [formError, setFormError] = useState("");

  function handleAreaChange(nextArea: string) {
    setArea(nextArea);
    setSupportedChannels((current) => normalizeDineInChannelForArea(current, nextArea));
  }

  async function handlePhotoChange(files: FileList | null) {
    if (!files?.length) return;
    const slots = Math.max(0, maxSubmissionPhotos - attachments.length);
    if (slots <= 0) {
      setPhotoStatus(`最多上传 ${maxSubmissionPhotos} 张菜单照片。`);
      return;
    }

    setPhotoStatus("正在压缩菜单照片...");
    try {
      const nextPhotos = await Promise.all(Array.from(files).slice(0, slots).map((file) => prepareSubmissionPhoto(file)));
      setAttachments((current) => [...current, ...nextPhotos].slice(0, maxSubmissionPhotos));
      setPhotoStatus(`已添加 ${nextPhotos.length} 张照片，提交后仅管理员可见。`);
    } catch (error) {
      setPhotoStatus(error instanceof Error ? error.message : "照片处理失败，请换一张清晰菜单图。");
    }
  }

  function submit() {
    const normalizedVendor = vendorName.trim();
    const normalizedArea = area.trim();
    const normalizedDish = dishName.trim();
    if (!normalizedVendor || !normalizedArea || (kind !== "new-vendor" && !note.trim())) {
      setFormError(kind === "new-vendor" ? "请填写商家名称和地点。" : "请填写商家名称、地点和说明。");
      return;
    }
    const normalizedSupportedChannels = supportedChannels.length ? supportedChannels : defaultCommunityChannels;
    setFormError("");
    onSubmit({
      id: makeSubmissionId(),
      kind,
      campus,
      channel: vendor?.channel ?? choosePrimaryChannel(normalizedSupportedChannels),
      supportedChannels: normalizedSupportedChannels,
      vendorId: vendor?.id,
      vendorName: normalizedVendor,
      itemId: item?.id,
      itemName: item?.name,
      area: normalizedArea,
      floor: floor.trim(),
      windowNo: windowNo.trim(),
      suggestedDish: normalizedDish,
      suggestedTags: tags.trim(),
      note: note.trim(),
      contact: contact.trim(),
      attachments,
      attachmentCount: attachments.length,
      createdAt: new Date().toISOString(),
      status: "pending",
    });
  }

  return (
    <div className="feedbackOverlay" role="dialog" aria-modal="true" aria-label="提交纠错或新增商家">
      <section className="feedbackPanel">
        <div className="feedbackHeader">
          <div>
            <p className="eyebrow">学生协作内测</p>
            <h2>{target.mode === "new-vendor" ? "补充商家/菜品" : "提交纠错"}</h2>
          </div>
          <button onClick={onClose}>关闭</button>
        </div>
        <div className="formHintLine">
          <span className="requiredMark">必填</span>
          商家名称、地点；纠错还需要说明。其他信息不确定可以先空着。
        </div>
        <div className="feedbackGrid">
          <label>
            <span className="labelLine">类型 <em>必填</em></span>
            <select value={kind} onChange={(event) => setKind(event.target.value as StudentSubmissionKind)}>
              <option value="correction">信息纠错</option>
              <option value="new-vendor">新增商家</option>
              <option value="new-dish">新增菜品</option>
              <option value="outdated">数据已过期</option>
              <option value="closed">商家停业</option>
            </select>
          </label>
          <div className="feedbackField">
            <span className="labelLine">支持方式 <em>必填</em></span>
            <div className="channelToggleGrid">
              {diningModeOptions.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={isSubmissionModeActive(supportedChannels, mode.id) ? "active" : ""}
                  onClick={() => setSupportedChannels((current) => toggleSubmissionMode(current, mode.id, area))}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="labelLine">商家/窗口 <em>必填</em></span>
            <input value={vendorName} onChange={(event) => setVendorName(event.target.value)} placeholder="如：老综某某拌饭" />
          </label>
          <label>
            <span className="labelLine">地点 <em>必填</em></span>
            <select value={area} onChange={(event) => handleAreaChange(event.target.value)}>
              {locationOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="labelLine">楼层/档口 <small>选填</small></span>
            <input value={[floor, windowNo].filter(Boolean).join(" · ")} readOnly hidden />
            <div className="inlineInputs">
              <input value={floor} onChange={(event) => setFloor(event.target.value)} placeholder="楼层" />
              <input value={windowNo} onChange={(event) => setWindowNo(event.target.value)} placeholder="档口号" />
            </div>
          </label>
          <label>
            <span className="labelLine">菜品 <small>选填</small></span>
            <input value={dishName} onChange={(event) => setDishName(event.target.value)} placeholder="菜品名，可留空只反馈商家" />
          </label>
          <label className="wide">
            <span className="labelLine">标签 <small>选填</small></span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="米饭、面、辣、清淡等" />
          </label>
          <label className="wide">
            <span className="labelLine">说明 {kind === "new-vendor" ? <small>选填</small> : <em>必填</em>}</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="哪里不对、现在真实菜单是什么、营业时间等" />
          </label>
          <div className="feedbackField wide">
            <span className="labelLine">菜单照片 <small>选填</small></span>
            <label className="photoDrop">
              <Camera size={18} />
              <span>上传菜单/价目表照片</span>
              <small>最多 {maxSubmissionPhotos} 张，会自动压缩，仅管理员审核可见</small>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  void handlePhotoChange(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            {attachments.length ? (
              <div className="photoPreviewGrid">
                {attachments.map((photo) => (
                  <div className="photoPreview" key={photo.id}>
                    <img src={photo.dataUrl} alt={photo.name} />
                    <button
                      type="button"
                      aria-label={`移除 ${photo.name}`}
                      onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== photo.id))}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {photoStatus ? <span className="photoStatus">{photoStatus}</span> : null}
          </div>
          <label className="wide">
            <span className="labelLine">联系方式 <small>选填</small></span>
            <input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="便于追问，不会展示给其他用户" />
          </label>
        </div>
        {formError ? <div className="formError">{formError}</div> : null}
        <button className="submitFeedback" onClick={submit}>
          <Send size={16} />
          提交到审核队列
        </button>
      </section>
    </div>
  );
}

async function prepareSubmissionPhoto(file: File): Promise<SubmissionAttachment> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只能上传图片文件。");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("单张照片请控制在 8MB 内。");
  }

  const sourceUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceUrl);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const qualities = [0.82, 0.72, 0.62, 0.52];
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob.size <= 900 * 1024) {
      return {
        id: `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name.slice(0, 90) || "menu-photo.jpg",
        mimeType: "image/jpeg",
        size: blob.size,
        dataUrl: await readBlobAsDataUrl(blob),
      };
    }
  }

  throw new Error("照片压缩后仍然偏大，请裁剪菜单区域后再上传。");
}

function readFileAsDataUrl(file: File) {
  return readBlobAsDataUrl(file);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，请换一张菜单照片。"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片压缩失败。"));
      },
      "image/jpeg",
      quality,
    );
  });
}

function SubmissionQueue({
  submissions,
  onExport,
  onClear,
}: {
  submissions: StudentSubmission[];
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <section className="submissionQueue" aria-label="学生提交审核队列">
      <div className="queueHeader">
        <div>
          <p className="eyebrow">待人工审核</p>
          <h2>学生提交队列</h2>
        </div>
        <div>
          <button onClick={onExport} disabled={!submissions.length}>
            <Download size={16} />
            导出 JSON
          </button>
          <button onClick={onClear} disabled={!submissions.length}>
            清空
          </button>
        </div>
      </div>
      {submissions.length ? (
        <div className="queueList">
          {submissions.slice(0, 8).map((submission) => (
            <article key={submission.id}>
              <strong>{submission.vendorName}</strong>
              <span>
                {submission.area} · {submission.suggestedDish || submission.itemName || "商家信息"}
              </span>
              {submission.attachmentCount ? <small>含 {submission.attachmentCount} 张菜单照片，等待管理员审核</small> : null}
              <p>{submission.note || "新增候选，等待审核。"}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyQueue">还没有学生提交。</div>
      )}
    </section>
  );
}

function toggleWantedType(preference: StudentPreference, type: FoodType): StudentPreference {
  const isActive = preference.wantedTypes.includes(type);

  return {
    ...preference,
    wantedTypes: isActive
      ? preference.wantedTypes.filter((current) => current !== type)
      : [...preference.wantedTypes, type],
  };
}

function getPrimaryType(preference: StudentPreference): PrimaryTypeChoice {
  return (primaryFoodTypeOptions.find((type) => preference.wantedTypes.includes(type)) as PrimaryTypeChoice | undefined) ?? "any";
}

function setPrimaryType(preference: StudentPreference, type: PrimaryTypeChoice): StudentPreference {
  const withoutPrimary = preference.wantedTypes.filter((current) => !primaryFoodTypeOptions.includes(current));
  return {
    ...preference,
    wantedTypes: type === "any" ? withoutPrimary : [type, ...withoutPrimary],
  };
}

function getFlavorType(preference: StudentPreference): FlavorTypeChoice {
  return (flavorFoodTypeOptions.find((type) => preference.wantedTypes.includes(type)) as FlavorTypeChoice | undefined) ?? "any";
}

function setFlavorType(preference: StudentPreference, type: FlavorTypeChoice): StudentPreference {
  const withoutFlavor = preference.wantedTypes.filter((current) => !flavorFoodTypeOptions.includes(current));
  return {
    ...preference,
    wantedTypes: type === "any" ? withoutFlavor : [...withoutFlavor, type],
  };
}

function isDiningModeActive(preference: StudentPreference, channels: Channel[]) {
  return channels.some((channel) => preference.selectedChannels.includes(channel));
}

function toggleDiningMode(preference: StudentPreference, channels: Channel[]): StudentPreference {
  const isActive = channels.some((channel) => preference.selectedChannels.includes(channel));
  const selectedChannels = isActive
    ? preference.selectedChannels.filter((current) => !channels.includes(current))
    : Array.from(new Set([...preference.selectedChannels, ...channels]));
  const normalizedChannels = selectedChannels.length > 0 ? selectedChannels : channels;
  const hasDineIn = normalizedChannels.some((channel) => channel === "canteen" || channel === "nearby");

  return {
    ...preference,
    selectedChannels: normalizedChannels,
    canteenAreas: hasDineIn ? preference.canteenAreas : [],
  };
}

function isSubmissionModeActive(channels: Channel[], modeId: string) {
  if (modeId === "delivery") return channels.includes("delivery");
  return channels.some((channel) => channel === "canteen" || channel === "nearby");
}

function toggleSubmissionMode(channels: Channel[], modeId: string, area: string): Channel[] {
  if (modeId === "delivery") {
    const next: Channel[] = channels.includes("delivery")
      ? channels.filter((current) => current !== "delivery")
      : [...channels, "delivery"];
    return next.length ? next : [dineInChannelForArea(area)];
  }

  const hasDineIn = channels.some((channel) => channel === "canteen" || channel === "nearby");
  const withoutDineIn = channels.filter((channel) => channel !== "canteen" && channel !== "nearby");
  const next: Channel[] = hasDineIn ? withoutDineIn : [dineInChannelForArea(area), ...withoutDineIn];
  return next.length ? next : [dineInChannelForArea(area)];
}

function normalizeDineInChannelForArea(channels: Channel[], area: string): Channel[] {
  if (!channels.some((channel) => channel === "canteen" || channel === "nearby")) {
    return channels;
  }
  const next = new Set<Channel>([
    dineInChannelForArea(area),
    ...channels.filter((channel) => channel !== "canteen" && channel !== "nearby"),
  ]);
  return Array.from(next);
}

function dineInChannelForArea(area: string): Channel {
  return area.includes("餐厅") ? "canteen" : "nearby";
}

function choosePrimaryChannel(channels: Channel[]): Channel {
  if (channels.includes("canteen")) return "canteen";
  if (channels.includes("nearby")) return "nearby";
  if (channels.includes("delivery")) return "delivery";
  return channels[0] ?? "canteen";
}

function toggleCanteenArea(preference: StudentPreference, area: string): StudentPreference {
  const canteenAreas = preference.canteenAreas.includes(area)
    ? preference.canteenAreas.filter((current) => current !== area)
    : [...preference.canteenAreas, area];

  return {
    ...preference,
    canteenAreas,
  };
}

export default App;

function formatChannelList(vendor: FoodVendor) {
  const channels = vendorChannels(vendor);
  const labels = [];
  if (channels.some((channel) => channel === "canteen" || channel === "nearby")) labels.push("堂食");
  if (channels.includes("delivery")) labels.push(channelLabels.delivery);
  return labels.join(" / ");
}

function choiceKey(vendorId: string, itemId: string) {
  return `${vendorId}:${itemId}`;
}

function loadRecentItems() {
  try {
    const raw = window.localStorage.getItem(recentStorageKey);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
