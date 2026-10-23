// Lightweight local helper for the private finance form. No external libraries or requests.
(() => {
  "use strict";
  const chars = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",
    л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",
    ч:"ch",ш:"sh",щ:"shch",ы:"y",э:"e",ю:"yu",я:"ya",ь:"",ъ:""
  };
  function normalize(value) {
    return Array.from(String(value).normalize("NFKD").toLocaleLowerCase("ru")
      .replace(/[\u0300-\u036f]/g,""))
      .map(c => chars[c] ?? c).join("")
      .replace(/[^a-z0-9]+/g," ").trim();
  }
  function resultsFor(options, query) {
    const words=normalize(query).split(/\s+/).filter(Boolean);
    if(!words.length)return options.slice(0,18);
    return options.filter(o => words.every(w=>o.key.includes(w))).slice(0,18);
  }
  function connect(selectId, inputId, popupId, allowNew) {
    const select=document.getElementById(selectId);
    const input=document.getElementById(inputId);
    const popup=document.getElementById(popupId);
    if(!select||!input||!popup)return;
    const options=Array.from(select.options).filter(o=>o.value).map(o=>({
      value:o.value,label:o.textContent.trim(),key:normalize(o.textContent)
    }));
    function close(){popup.hidden=true;popup.replaceChildren();}
    function choose(option){
      select.value=option.value;
      input.value=option.label;
      close();
    }
    function render(items) {
      popup.replaceChildren();
      for(const option of items){
        const item=document.createElement("button");
        item.type="button";
        item.setAttribute("role","option");
        item.textContent=option.label;
        item.addEventListener("click",()=>choose(option));
        popup.append(item);
      }
      popup.hidden=!items.length;
    }
    select.addEventListener("change",()=>{
      input.value=select.selectedIndex>0?select.selectedOptions[0].textContent.trim():"";
      close();
    });
    input.addEventListener("input",()=>{
      const wanted=normalize(input.value);
      // Product field accepts a choice from the verified catalog only.
      // The supplier field may be free text; the server will create it.
      const exact=options.find(o=>o.key===wanted);
      select.value=exact?exact.value:"";
      render(resultsFor(options,input.value));
      if(!input.value.trim())close();
    });
    input.addEventListener("focus",()=>{
      if(input.value.trim())render(resultsFor(options,input.value));
    });
    input.addEventListener("keydown",event=>{
      if(event.key==="Escape"){close();return;}
      if(event.key==="Enter" && !popup.hidden){
        const first=popup.querySelector("button");
        if(first){event.preventDefault();first.click();}
      }
      if(event.key==="ArrowDown" && !popup.hidden){
        const first=popup.querySelector("button");
        if(first){event.preventDefault();first.focus();}
      }
    });
    popup.addEventListener("keydown",event=>{
      const buttons=Array.from(popup.querySelectorAll("button"));
      const index=buttons.indexOf(document.activeElement);
      if(event.key==="Escape"){event.preventDefault();close();input.focus();}
      if(event.key==="ArrowDown" && index>=0){
        event.preventDefault();buttons[Math.min(index+1,buttons.length-1)].focus();
      }
      if(event.key==="ArrowUp" && index>=0){
        event.preventDefault();if(index===0)input.focus();else buttons[index-1].focus();
      }
    });
    document.addEventListener("click",event=>{
      if(!popup.parentElement.contains(event.target))close();
    });
    if(!allowNew){
      const form=select.closest("form");
      if(form)form.addEventListener("submit",event=>{
        if(!select.value){
          event.preventDefault();
          input.setCustomValidity("Выберите товар, цвет и размер из подсказки или полного списка.");
          input.reportValidity();
          input.focus();
        }
      });
      input.addEventListener("input",()=>input.setCustomValidity(""));
      select.addEventListener("change",()=>input.setCustomValidity(""));
    }
  }
  if(typeof document==="undefined")return;
  const ready=()=>{
    connect("receipt-sku-select","receipt-sku-search","receipt-sku-suggestions",false);
    connect("receipt-supplier-select","receipt-supplier-input","receipt-supplier-suggestions",true);
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);
  else ready();
})();
