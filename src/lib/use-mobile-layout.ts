import { useEffect, useState } from "react";

export function useMobileLayout() {
  const read = () =>
    document.documentElement.classList.contains("native-app") &&
    window.matchMedia("(max-width: 820px)").matches;
  const [mobile, setMobile] = useState(read);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 820px)");
    const update = () => setMobile(read());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
