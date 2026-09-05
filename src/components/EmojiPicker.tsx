import React, { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Flame, Heart, Search, Smile, Sparkles, X } from "lucide-react";

export type EmojiItem = {
  char: string;
  name: string;
  keywords: string[];
};

export const EMOJI_CATEGORIES: {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  emojis: EmojiItem[];
}[] = [
  {
    id: "smileys",
    label: "Faccine & Emozioni",
    icon: Smile,
    emojis: [
      { char: "😀", name: "grinning", keywords: ["sorriso", "smile", "happy", "felice"] },
      { char: "😃", name: "smiley", keywords: ["smile", "happy", "felice", "gioia"] },
      { char: "😄", name: "smile", keywords: ["occhi", "eyes", "happy"] },
      { char: "😁", name: "grin", keywords: ["denti", "teeth", "felice"] },
      { char: "😆", name: "laughing", keywords: ["riso", "laugh", "divertente", "funny"] },
      { char: "😅", name: "sweat_smile", keywords: ["sudore", "sollievo", "sweat"] },
      { char: "🤣", name: "rofl", keywords: ["morto", "lol", "ridere", "laugh"] },
      { char: "😂", name: "joy", keywords: ["lacrime", "tears", "piango", "laugh", "lol"] },
      { char: "🙂", name: "slightly_smiling", keywords: ["sorriso", "smile", "ok"] },
      { char: "🙃", name: "upside_down", keywords: ["sottosopra", "ironia", "sarcasm"] },
      { char: "😉", name: "wink", keywords: ["occhiolino", "wink", "intesa"] },
      { char: "😊", name: "blush", keywords: ["rossore", "carino", "cute"] },
      { char: "😇", name: "innocent", keywords: ["angelo", "angel", "innocente"] },
      { char: "🥰", name: "smiling_hearts", keywords: ["amore", "love", "affetto"] },
      { char: "😍", name: "heart_eyes", keywords: ["innamorato", "love", "adoro"] },
      { char: "🤩", name: "star_struck", keywords: ["stelle", "star", "wow", "super"] },
      { char: "😘", name: "kissing_heart", keywords: ["bacio", "kiss", "amore"] },
      { char: "😋", name: "yum", keywords: ["buono", "food", "lingua", "yummy"] },
      { char: "😛", name: "stuck_out_tongue", keywords: ["linguaccia", "tongue", "scherzo"] },
      { char: "😜", name: "stuck_out_tongue_winking_eye", keywords: ["linguaccia", "pazzo", "crazy"] },
      { char: "🤪", name: "zany", keywords: ["folle", "pazzo", "crazy"] },
      { char: "😎", name: "sunglasses", keywords: ["cool", "figo", "sole", "occhiali"] },
      { char: "🤓", name: "nerd", keywords: ["nerd", "studio", "geek"] },
      { char: "🧐", name: "monocle", keywords: ["monocolo", "indagine", "curioso"] },
      { char: "🥳", name: "partying", keywords: ["festa", "party", "compleanno", "evviva"] },
      { char: "😏", name: "smirk", keywords: ["furbo", "smirk", "malizia"] },
      { char: "😒", name: "unamused", keywords: ["scazzato", "noia", "annoyed"] },
      { char: "🙄", name: "roll_eyes", keywords: ["occhi al cielo", "uffa", "whatever"] },
      { char: "😬", name: "grimacing", keywords: ["imbarazzo", "ouch", "yikes"] },
      { char: "🤥", name: "lying", keywords: ["bugia", "pinocchio", "lie"] },
      { char: "😌", name: "relieved", keywords: ["rilassato", "pace", "calma"] },
      { char: "😔", name: "pensive", keywords: ["triste", "sad", "pensieroso"] },
      { char: "😪", name: "sleepy", keywords: ["sonno", "tired", "stanco"] },
      { char: "🤤", name: "drooling", keywords: ["sbavare", "fame", "food"] },
      { char: "😴", name: "sleeping", keywords: ["dormire", "sleep", "zzz"] },
      { char: "😷", name: "mask", keywords: ["mascherina", "malato", "sick"] },
      { char: "🤒", name: "thermometer", keywords: ["febbre", "malato", "sick"] },
      { char: "🤕", name: "bandage", keywords: ["benda", "ferito", "hurt"] },
      { char: "🤢", name: "nauseated", keywords: ["nausea", "schifo", "gross"] },
      { char: "🤮", name: "vomiting", keywords: ["vomito", "bleah"] },
      { char: "🤧", name: "sneezing", keywords: ["starnuto", "raffreddore"] },
      { char: "🥵", name: "hot", keywords: ["caldo", "hot", "sudore"] },
      { char: "🥶", name: "cold", keywords: ["freddo", "gelo", "cold"] },
      { char: "🥴", name: "woozy", keywords: ["sbronzo", "ubriaco", "dizzy"] },
      { char: "😵", name: "dizzy", keywords: ["confuso", "capogiro"] },
      { char: "🤯", name: "exploding_head", keywords: ["mente", "mind blown", "shock", "boom"] },
      { char: "🤠", name: "cowboy", keywords: ["cowboy", "cappello"] },
      { char: "🥺", name: "pleading", keywords: ["ti prego", "please", "occhioni", "cute"] },
      { char: "😭", name: "sob", keywords: ["pianto", "lacrime", "cry", "sad"] },
      { char: "😱", name: "scream", keywords: ["urlo", "paura", "shock"] },
      { char: "😖", name: "confounded", keywords: ["frustrato", "ansia"] },
      { char: "😣", name: "persevere", keywords: ["fatica", "stress"] },
      { char: "😞", name: "disappointed", keywords: ["deluso", "sad"] },
      { char: "😤", name: "triumph", keywords: ["fumo", "rabbia", "fiero"] },
      { char: "😡", name: "rage", keywords: ["arrabbiato", "mad", "rabbia", "furia"] },
      { char: "😠", name: "angry", keywords: ["incavolato", "angry"] },
      { char: "🤬", name: "cursing", keywords: ["imprecazioni", "swear", "censurato"] },
      { char: "😈", name: "devil", keywords: ["diavolo", "malvagio", "evil"] },
      { char: "👿", name: "angry_devil", keywords: ["diavolo", "rabbia"] },
      { char: "💀", name: "skull", keywords: ["teschio", "morto", "dead", "rip", "lol"] },
      { char: "☠️", name: "skull_crossbones", keywords: ["pericolo", "pirata", "danger"] },
      { char: "💩", name: "poop", keywords: ["cacca", "poop", "merda"] },
      { char: "🤡", name: "clown", keywords: ["pagliaccio", "clown", "buffone"] },
      { char: "👻", name: "ghost", keywords: ["fantasma", "ghost", "boo"] },
      { char: "👽", name: "alien", keywords: ["alieno", "ufo", "space"] },
      { char: "🤖", name: "robot", keywords: ["robot", "bot", "ai"] },
    ],
  },
  {
    id: "gestures",
    label: "Mani & Gesti",
    icon: Flame,
    emojis: [
      { char: "👍", name: "thumbs_up", keywords: ["ok", "bene", "like", "si", "yes"] },
      { char: "👎", name: "thumbs_down", keywords: ["no", "dislike", "male"] },
      { char: "👏", name: "clapping", keywords: ["applauso", "bravissimo", "clap"] },
      { char: "🙌", name: "raising_hands", keywords: ["evviva", "urrà", "praise"] },
      { char: "👐", name: "open_hands", keywords: ["mani aperte", "abbraccio"] },
      { char: "🤲", name: "palms_up", keywords: ["preghiera", "offerta"] },
      { char: "🤝", name: "handshake", keywords: ["accordo", "stretta", "deal"] },
      { char: "🙏", name: "folded_hands", keywords: ["grazie", "prego", "please", "thank you", "speriamo"] },
      { char: "✌️", name: "victory", keywords: ["pace", "peace", "vittoria", "due"] },
      { char: "🤞", name: "crossed_fingers", keywords: ["dita incrociate", "fortuna", "hope"] },
      { char: "🤟", name: "love_you_gesture", keywords: ["love you", "affetto"] },
      { char: "🤘", name: "rock_on", keywords: ["rock", "metal", "corna"] },
      { char: "👌", name: "ok_hand", keywords: ["perfetto", "ok", "ottimo"] },
      { char: "🤏", name: "pinching_hand", keywords: ["poco", "piccolo", "small"] },
      { char: "👈", name: "point_left", keywords: ["sinistra", "guarda"] },
      { char: "👉", name: "point_right", keywords: ["destra", "guarda"] },
      { char: "👆", name: "point_up", keywords: ["su", "sopra"] },
      { char: "👇", name: "point_down", keywords: ["giù", "sotto"] },
      { char: "☝️", name: "index_up", keywords: ["uno", "attenzione"] },
      { char: "✋", name: "raised_hand", keywords: ["stop", "alto", "fermati"] },
      { char: "🤚", name: "back_of_hand", keywords: ["mano"] },
      { char: "🖐", name: "five_fingers", keywords: ["cinque"] },
      { char: "🖖", name: "vulcan", keywords: ["spock", "saluto vulcaniano"] },
      { char: "👋", name: "waving", keywords: ["ciao", "saluto", "bye", "hello"] },
      { char: "🤙", name: "call_me", keywords: ["chiamami", "shaka"] },
      { char: "💪", name: "muscle", keywords: ["forza", "muscoli", "strong", "potenza"] },
      { char: "🦾", name: "mechanical_arm", keywords: ["bionico", "robot"] },
      { char: "🖕", name: "middle_finger", keywords: ["dito medio", "vaffanculo"] },
      { char: "👊", name: "fist", keywords: ["pugno", "brofist"] },
      { char: "🤛", name: "left_fist", keywords: ["pugno"] },
      { char: "🤜", name: "right_fist", keywords: ["pugno"] },
      { char: "👀", name: "eyes", keywords: ["occhi", "guarda", "interessante", "look"] },
      { char: "🧠", name: "brain", keywords: ["cervello", "mente", "smart"] },
    ],
  },
  {
    id: "hearts",
    label: "Cuori & Simboli",
    icon: Heart,
    emojis: [
      { char: "❤️", name: "red_heart", keywords: ["cuore", "amore", "love", "red"] },
      { char: "🧡", name: "orange_heart", keywords: ["arancione", "cuore"] },
      { char: "💛", name: "yellow_heart", keywords: ["giallo", "cuore", "amicizia"] },
      { char: "💚", name: "green_heart", keywords: ["verde", "cuore", "natura"] },
      { char: "💙", name: "blue_heart", keywords: ["blu", "cuore"] },
      { char: "💜", name: "purple_heart", keywords: ["viola", "cuore"] },
      { char: "🖤", name: "black_heart", keywords: ["nero", "cuore", "dark"] },
      { char: "🤍", name: "white_heart", keywords: ["bianco", "cuore", "puro"] },
      { char: "🤎", name: "brown_heart", keywords: ["marrone", "cuore"] },
      { char: "💔", name: "broken_heart", keywords: ["cuore spezzato", "addio", "tristezza"] },
      { char: "❣️", name: "heart_exclamation", keywords: ["esclamazione", "cuore"] },
      { char: "💕", name: "two_hearts", keywords: ["due cuori", "amore"] },
      { char: "💞", name: "revolving_hearts", keywords: ["cuori rotanti"] },
      { char: "💓", name: "beating_heart", keywords: ["battito", "pulsante"] },
      { char: "💗", name: "growing_heart", keywords: ["cuore che cresce"] },
      { char: "💖", name: "sparkling_heart", keywords: ["luccicante", "sparkle"] },
      { char: "💘", name: "cupid", keywords: ["cupido", "freccia"] },
      { char: "💝", name: "gift_heart", keywords: ["regalo", "fiocco"] },
      { char: "🔥", name: "fire", keywords: ["fuoco", "fiamma", "caldo", "bomba", "top", "lit"] },
      { char: "✨", name: "sparkles", keywords: ["stelle", "magia", "brillio", "sparkle"] },
      { char: "🌟", name: "glowing_star", keywords: ["stella splendente", "star"] },
      { char: "⭐", name: "star", keywords: ["stella", "voto"] },
      { char: "⚡", name: "zap", keywords: ["fulmine", "energia", "velocità", "elettricità"] },
      { char: "💥", name: "collision", keywords: ["esplosione", "boom", "colpo"] },
      { char: "💯", name: "100", keywords: ["cento", "perfetto", "top", "pieno"] },
      { char: "💢", name: "anger", keywords: ["rabbia", "anime"] },
      { char: "💤", name: "zzz", keywords: ["sonno", "dormire"] },
      { char: "🎉", name: "party_popper", keywords: ["festa", "tanti auguri", "congrats", "evviva"] },
      { char: "🎊", name: "confetti", keywords: ["coriandoli", "celebrazione"] },
    ],
  },
  {
    id: "objects",
    label: "Attività & Oggetti",
    icon: Sparkles,
    emojis: [
      { char: "🚀", name: "rocket", keywords: ["razzo", "decollo", "luna", "hype", "fast"] },
      { char: "🍕", name: "pizza", keywords: ["cibo", "food", "cena", "italiana"] },
      { char: "🍔", name: "hamburger", keywords: ["burger", "fast food", "panino"] },
      { char: "🍟", name: "fries", keywords: ["patatine", "food"] },
      { char: "🍺", name: "beer", keywords: ["birra", "drink", "festa", "brindisi"] },
      { char: "🍻", name: "beers", keywords: ["brindisi", "salute", "cheers"] },
      { char: "☕", name: "coffee", keywords: ["caffè", "pausa", "espresso"] },
      { char: "🎮", name: "video_game", keywords: ["videogioco", "controller", "gaming", "play"] },
      { char: "🎲", name: "game_die", keywords: ["dado", "gioco", "fortuna"] },
      { char: "🎵", name: "musical_note", keywords: ["musica", "nota", "brano"] },
      { char: "🎶", name: "notes", keywords: ["musica", "canzone"] },
      { char: "🎧", name: "headphones", keywords: ["cuffie", "ascolto", "audio"] },
      { char: "💻", name: "laptop", keywords: ["computer", "pc", "lavoro", "codice"] },
      { char: "📱", name: "mobile_phone", keywords: ["telefono", "smartphone", "cellulare"] },
      { char: "💡", name: "bulb", keywords: ["idea", "luce", "lampadina"] },
      { char: "💎", name: "gem", keywords: ["diamante", "gioiello", "prezioso"] },
      { char: "🏆", name: "trophy", keywords: ["trofeo", "vittoria", "coppa", "campione"] },
      { char: "🥇", name: "1st_place", keywords: ["primo", "oro", "medaglia"] },
      { char: "🎯", name: "direct_hit", keywords: ["bersaglio", "centro", "target"] },
      { char: "🚗", name: "car", keywords: ["macchina", "auto", "viaggio"] },
      { char: "✈️", name: "airplane", keywords: ["aereo", "volo", "vacanza"] },
      { char: "🌈", name: "rainbow", keywords: ["arcobaleno", "colori"] },
      { char: "☀️", name: "sun", keywords: ["sole", "estate", "bel tempo"] },
      { char: "🌙", name: "moon", keywords: ["luna", "notte", "buonanotte"] },
      { char: "🪐", name: "planet", keywords: ["pianeta", "saturno", "spazio"] },
      { char: "🐱", name: "cat", keywords: ["gatto", "micio", "kitty"] },
      { char: "🐶", name: "dog", keywords: ["cane", "cucciolo", "cagnolino"] },
      { char: "🦊", name: "fox", keywords: ["volpe", "furba"] },
      { char: "🐸", name: "frog", keywords: ["rana", "pepe"] },
    ],
  },
];

const RECENT_STORAGE_KEY = "hush:recent_emojis";

function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, 16);
    }
  } catch {}
  return ["😂", "🔥", "❤️", "👍", "🥳", "🥺", "✨", "😍", "😭", "💀", "🤔", "👀", "🚀", "🎉"];
}

function saveRecentEmoji(char: string) {
  try {
    const recents = loadRecentEmojis().filter((e) => e !== char);
    recents.unshift(char);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recents.slice(0, 20)));
  } catch {}
}

export type EmojiPickerProps = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("smileys");
  const [recents, setRecents] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(loadRecentEmojis());
    searchInputRef.current?.focus();
  }, []);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose]);

  const handleEmojiClick = (char: string) => {
    saveRecentEmoji(char);
    setRecents((prev) => [char, ...prev.filter((c) => c !== char)].slice(0, 16));
    onSelect(char);
  };

  const filteredEmojis = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;

    const results: EmojiItem[] = [];
    const seen = new Set<string>();

    for (const cat of EMOJI_CATEGORIES) {
      for (const item of cat.emojis) {
        if (seen.has(item.char)) continue;
        if (
          item.name.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.toLowerCase().includes(q))
        ) {
          results.push(item);
          seen.add(item.char);
        }
      }
    }
    return results;
  }, [search]);

  return (
    <div className="emoji-picker-popover" ref={containerRef} role="dialog" aria-label="Selettore emoji">
      <div className="emoji-picker-header">
        <div className="emoji-picker-search-wrap">
          <Search size={14} className="emoji-picker-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="emoji-picker-search"
            placeholder="Cerca emoji (es. cuore, smile, fuoco)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              type="button"
              className="emoji-picker-clear"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
              aria-label="Cancella ricerca"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="emoji-picker-tabs">
        {recents.length > 0 && !search ? (
          <button
            type="button"
            className={`emoji-picker-tab ${activeCategory === "recent" ? "active" : ""}`}
            onClick={() => setActiveCategory("recent")}
            title="Recenti"
          >
            <Clock size={15} />
          </button>
        ) : null}
        {!search &&
          EMOJI_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                type="button"
                key={cat.id}
                className={`emoji-picker-tab ${activeCategory === cat.id ? "active" : ""}`}
                onClick={() => setActiveCategory(cat.id)}
                title={cat.label}
              >
                <Icon size={15} />
              </button>
            );
          })}
      </div>

      <div className="emoji-picker-body">
        {filteredEmojis ? (
          <div className="emoji-picker-section">
            <span className="emoji-picker-category-label">
              Risultati ({filteredEmojis.length})
            </span>
            {filteredEmojis.length === 0 ? (
              <div className="emoji-picker-empty">Nessuna emoji trovata</div>
            ) : (
              <div className="emoji-picker-grid">
                {filteredEmojis.map((item) => (
                  <button
                    key={item.char}
                    type="button"
                    className="emoji-btn"
                    title={item.name}
                    onClick={() => handleEmojiClick(item.char)}
                  >
                    {item.char}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : activeCategory === "recent" && recents.length > 0 ? (
          <div className="emoji-picker-section">
            <span className="emoji-picker-category-label">Usate di recente</span>
            <div className="emoji-picker-grid">
              {recents.map((char) => (
                <button
                  key={char}
                  type="button"
                  className="emoji-btn"
                  onClick={() => handleEmojiClick(char)}
                >
                  {char}
                </button>
              ))}
            </div>
          </div>
        ) : (
          (() => {
            const cat = EMOJI_CATEGORIES.find((c) => c.id === activeCategory) || EMOJI_CATEGORIES[0];
            return (
              <div className="emoji-picker-section">
                <span className="emoji-picker-category-label">{cat.label}</span>
                <div className="emoji-picker-grid">
                  {cat.emojis.map((item) => (
                    <button
                      key={item.char}
                      type="button"
                      className="emoji-btn"
                      title={item.name}
                      onClick={() => handleEmojiClick(item.char)}
                    >
                      {item.char}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
