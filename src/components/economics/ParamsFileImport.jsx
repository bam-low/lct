import { useRef, useState } from "react";
import { exportParamsCsv, parseParamsCsv, downloadTextFile } from "../../domain/paramsFile.js";

// Загрузка/выгрузка параметров объекта из CSV-шаблона (ТЗ 3.2.3–3.2.4). Работает
// для любого objectType с paramSchema — ничего здесь не завязано на склад,
// поэтому аэропорт и медучреждение получат импорт бесплатно, как только у них
// появится собственный экран параметров.
export default function ParamsFileImport({ objectType, params, onApply }) {
  const fileInputRef = useRef(null);
  const [result, setResult] = useState(null); // { appliedCount, errors }

  const handleDownload = () => {
    downloadTextFile(`${objectType.id}-parametry-shablon.csv`, exportParamsCsv(objectType, params));
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const text = await file.text();
    const { values, errors } = parseParamsCsv(text, objectType);

    if (Object.keys(values).length > 0) onApply(values);
    setResult({ appliedCount: Object.keys(values).length, errors });
  };

  return (
    <div className="bg-white/40 rounded-xl p-3 space-y-2">
      <div className="text-sm font-bold text-[#3F4159]">Загрузка параметров из файла</div>
      <p className="text-xs text-[#6b5f7a]">
        Скачайте шаблон, заполните колонку «Значение» (можно в Excel — сохранить как CSV UTF-8) и
        загрузите обратно. Поддерживается CSV; отдельные значения можно поправить прямо в форме
        ниже без файла.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleDownload}
          className="text-xs px-3 py-1.5 rounded-full bg-white/80 hover:bg-white text-[#3F4159] font-semibold shadow-sm"
        >
          ⭳ Скачать шаблон CSV
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-full bg-[#3F4159] hover:brightness-110 text-white font-semibold shadow-sm"
        >
          ⭱ Загрузить CSV
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      </div>

      {result && (
        <div className="text-xs space-y-1">
          {result.appliedCount > 0 && (
            <p className="text-[#2E7D46] font-semibold">Применено значений: {result.appliedCount}.</p>
          )}
          {result.errors.length > 0 && (
            <div className="text-[#9C3B3B]">
              <p className="font-semibold">Не применено ({result.errors.length}) — исправьте и загрузите снова, либо поправьте вручную в форме:</p>
              <ul className="list-disc list-inside">
                {result.errors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
