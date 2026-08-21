const sourcesRoot = document.getElementById("sources");
const cancelButton = document.getElementById("cancel");

window.hushPicker.onSources((sources) => {
  sourcesRoot.replaceChildren();
  for (const source of sources) {
    const button = document.createElement("button");
    const image = document.createElement("img");
    const label = document.createElement("span");
    button.type = "button";
    button.className = "source";
    button.title = source.name;
    image.src = source.thumbnail;
    image.alt = "";
    label.textContent = source.name;
    button.append(image, label);
    button.addEventListener("click", () => window.hushPicker.select(source.id));
    sourcesRoot.append(button);
  }
});

cancelButton.addEventListener("click", () => window.hushPicker.cancel());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.hushPicker.cancel();
});
