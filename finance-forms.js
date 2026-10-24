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
        if(!select.disabled&&!select.value){
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
  if(typeof module==="object" && module.exports)module.exports={normalize,resultsFor};
  if(typeof document==="undefined")return;
  const ready=()=>{
    connect("receipt-sku-select","receipt-sku-search","receipt-sku-suggestions",false);
    const group=document.getElementById("receipt-group-select");
    const sizesBox=document.getElementById("receipt-size-table");
    const legacy=document.getElementById("receipt-one-size");
    const oldSku=document.getElementById("receipt-sku-select");
    const oldSearch=document.getElementById("receipt-sku-search");
    const oldQty=document.getElementById("receipt-legacy-qty");
    const groupSearch=document.getElementById("receipt-group-search");
    const groupToggle=document.getElementById("receipt-group-toggle");
    const groupPopup=document.getElementById("receipt-group-suggestions");
    function connectGroupPicker(){
      if(!group||!groupSearch||!groupToggle||!groupPopup)return;
      const all=Array.from(group.options).filter(o=>o.value).map(o=>({
        value:o.value,label:o.textContent.trim(),key:normalize(o.textContent)
      }));
      function close(){
        groupPopup.hidden=true;
        groupPopup.replaceChildren();
        groupSearch.setAttribute("aria-expanded","false");
        groupToggle.setAttribute("aria-expanded","false");
      }
      function choose(item){
        group.value=item.value;
        groupSearch.value=item.label;
        groupSearch.setCustomValidity("");
        group.dispatchEvent(new Event("change",{bubbles:true}));
        close();
        groupSearch.focus();
      }
      function render(items){
        groupPopup.replaceChildren();
        if(!items.length){
          const message=document.createElement("p");
          message.className="field-help";
          message.textContent="Совпадений нет. Новый товар сначала добавьте через Pages CMS.";
          groupPopup.append(message);
        }
        for(const item of items){
          const button=document.createElement("button");
          button.type="button";
          button.setAttribute("role","option");
          button.textContent=item.label;
          button.addEventListener("click",()=>choose(item));
          groupPopup.append(button);
        }
        groupPopup.hidden=false;
        groupSearch.setAttribute("aria-expanded","true");
        groupToggle.setAttribute("aria-expanded","true");
      }
      groupSearch.addEventListener("input",()=>{
        group.value="";
        group.dispatchEvent(new Event("change",{bubbles:true}));
        groupSearch.setCustomValidity("");
        if(groupSearch.value.trim())render(resultsFor(all,groupSearch.value));
        else close();
      });
      groupToggle.addEventListener("click",()=>{
        if(groupPopup.hidden)render(all);
        else close();
        groupSearch.focus();
      });
      groupSearch.addEventListener("keydown",event=>{
        if(event.key==="Escape"){close();return;}
        if(event.key==="ArrowDown"){
          if(groupPopup.hidden)render(all);
          const first=groupPopup.querySelector("button");
          if(first){event.preventDefault();first.focus();}
        }
        if(event.key==="Enter"&&!groupPopup.hidden){
          const first=groupPopup.querySelector("button");
          if(first){event.preventDefault();first.click();}
        }
      });
      groupPopup.addEventListener("keydown",event=>{
        const buttons=Array.from(groupPopup.querySelectorAll("button"));
        const index=buttons.indexOf(document.activeElement);
        if(event.key==="Escape"){event.preventDefault();close();groupSearch.focus();}
        if(event.key==="ArrowDown"&&index>=0){
          event.preventDefault();buttons[Math.min(index+1,buttons.length-1)].focus();
        }
        if(event.key==="ArrowUp"&&index>=0){
          event.preventDefault();if(index===0)groupSearch.focus();else buttons[index-1].focus();
        }
      });
      document.addEventListener("click",event=>{
        if(!groupPopup.parentElement.contains(event.target))close();
      });
      const form=group.closest("form");
      form?.addEventListener("submit",event=>{
        if(group.disabled||group.value)return;
        event.preventDefault();
        groupSearch.setCustomValidity("Выберите существующий товар и цвет из подсказки или полного списка.");
        groupSearch.reportValidity();
        groupSearch.focus();
      });
    }
    function showSizes(){
      if(!group||!sizesBox)return;
      const option=group.selectedOptions[0];
      let sizes=[];
      try{sizes=JSON.parse(option?.dataset.sizes||"[]");}catch{sizes=[];}
      sizesBox.replaceChildren();
      if(!sizes.length){
        const hint=document.createElement("p");hint.className="muted";
        hint.textContent="Выберите товар и цвет, чтобы увидеть размеры.";
        sizesBox.append(hint);
      }
      for(const size of sizes){
        const label=document.createElement("label");
        label.className="receipt-size-row";
        const caption=document.createElement("span");
        caption.textContent="Размер "+size;
        const sizeInput=document.createElement("input");
        sizeInput.type="hidden";sizeInput.name="receipt_size";sizeInput.value=size;
        const qty=document.createElement("input");
        qty.type="number";qty.name="receipt_qty";qty.min="0";qty.max="1000000";qty.step="1";qty.value="0";
        qty.setAttribute("aria-label","Количество — размер "+size);
        label.append(caption,sizeInput,qty);
        sizesBox.append(label);
      }
      synchronizeReceiptMode();
    }
    function synchronizeReceiptMode(){
      const intake=document.getElementById("receipt-main-fields");
      const receiving=document.getElementById("finance-operation-mode")?.value!=="settlement";
      const single=Boolean(legacy?.open);
      if(!intake)return;
      if(group)group.disabled=!receiving||single;
      if(groupSearch){groupSearch.disabled=!receiving||single;groupSearch.required=receiving&&!single;}
      if(groupToggle)groupToggle.disabled=!receiving||single;
      if(!receiving||single){groupPopup?.setAttribute("hidden","");groupSearch?.setAttribute("aria-expanded","false");groupToggle?.setAttribute("aria-expanded","false");}
      sizesBox?.querySelectorAll("input").forEach(input=>input.disabled=!receiving||single);
      if(oldSku){oldSku.disabled=!receiving||!single;oldSku.required=receiving&&single;}
      if(oldSearch)oldSearch.disabled=!receiving||!single;
      if(oldQty){oldQty.disabled=!receiving||!single;oldQty.required=receiving&&single;}
    }
    if(group){group.addEventListener("change",showSizes);showSizes();connectGroupPicker();}
    if(sizesBox)sizesBox.addEventListener("input",event=>{
      if(event.target?.name==="receipt_qty")event.target.setCustomValidity("");
    });
    if(legacy)legacy.addEventListener("toggle",synchronizeReceiptMode);

    connect("receipt-supplier-select","receipt-supplier-input","receipt-supplier-suggestions",true);
    const expenses=document.getElementById("receipt-expenses");
    const add=document.getElementById("add-receipt-expense");
    const first=expenses?.querySelector(".expense-line");
    if(expenses&&first&&add){
      add.addEventListener("click",()=>{
        if(expenses.querySelectorAll(".expense-line").length>=10)return;
        const line=first.cloneNode(true);
        line.querySelectorAll("input").forEach(input=>input.value="");
        expenses.append(line);
        line.querySelector("input")?.focus();
        if(expenses.querySelectorAll(".expense-line").length>=10)add.hidden=true;
      });
    }
    const submit=document.getElementById("confirm-receipt");
    const form=submit?.closest("form");
    const mode=document.getElementById("finance-operation-mode");
    const receiptFields=document.getElementById("receipt-main-fields");
    const existingBox=document.getElementById("existing-receipt-select");
    const existingSelect=document.getElementById("finance-existing-receipt");
    if(mode&&receiptFields&&existingBox&&existingSelect){
      const hasSkuChoices=Boolean(document.querySelector("#receipt-sku-select option[value]:not([value=''])"));
      const toggle=()=>{
        const receiving=mode.value==="receipt";
        receiptFields.hidden=!receiving;
        existingBox.hidden=receiving;
        existingSelect.disabled=receiving;
        receiptFields.querySelectorAll("input,select,textarea").forEach(control=>{
          control.disabled=!receiving;
        });
        if(submit)submit.disabled=receiving&&!hasSkuChoices;
      };
      mode.addEventListener("change",toggle);
      mode.addEventListener("change",synchronizeReceiptMode);
      toggle();
      synchronizeReceiptMode();
    }
    if(form){
      let submitted=false;
      form.addEventListener("submit",event=>{
        if(event.defaultPrevented)return;
        if(mode?.value==="receipt"&&!legacy?.open){
          const quantities=Array.from(sizesBox?.querySelectorAll('input[name="receipt_qty"]')||[]);
          if(!quantities.some(input=>Number(input.value)>0)){
            event.preventDefault();
            const current=quantities[0];
            if(current){current.setCustomValidity("Укажи хотя бы одно положительное количество.");current.reportValidity();current.focus();}
            else {group?.setCustomValidity("Выбери товар и цвет.");group?.reportValidity();}
            return;
          }
          quantities.forEach(input=>input.setCustomValidity(""));
        }
        if(submitted){event.preventDefault();return;}
        submitted=true;
        submit.disabled=true;
        submit.textContent="Записываем поступление и расчёты…";
      });
    }
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);
  else ready();
})();
