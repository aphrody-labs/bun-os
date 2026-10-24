// SPDX-License-Identifier: Apache-2.0
const search = document.querySelector("#studio-search");
const filters = [...document.querySelectorAll("[data-filter]")];
const cards = [...document.querySelectorAll("[data-category]")];
let category = "all";
function update() {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  for (const card of cards) {
    card.hidden =
      !(category === "all" || card.dataset.category === category) ||
      !card.textContent.toLocaleLowerCase().includes(query);
    if (!card.hidden) count++;
  }
  document.querySelector(".empty").hidden = count !== 0;
  document.querySelector("#result-count").textContent = `${count} ${count === 1 ? "studio" : "studios"} available`;
}
for (const button of filters)
  button.addEventListener("click", () => {
    category = button.dataset.filter;
    for (const filter of filters) filter.setAttribute("aria-pressed", String(filter === button));
    update();
  });
search.addEventListener("input", update);
document.querySelector("#reset").addEventListener("click", () => {
  search.value = "";
  filters[0].click();
  search.focus();
});
