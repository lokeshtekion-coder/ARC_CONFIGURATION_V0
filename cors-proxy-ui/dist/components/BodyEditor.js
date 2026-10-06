import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const BodyEditor = ({ value, onChange, disabled }) => {
    const prettify = () => {
        try {
            onChange(JSON.stringify(JSON.parse(value), null, 2));
        }
        catch { }
    };
    return (_jsxs("div", { className: "body-editor", children: [_jsxs("div", { className: "body-toolbar", children: [_jsx("span", { className: "body-label", children: "JSON Body" }), !disabled && (_jsx("button", { onClick: prettify, className: "btn-secondary btn-sm", children: "Prettify" }))] }), _jsx("textarea", { className: "body-textarea", value: value, onChange: (e) => onChange(e.target.value), placeholder: '{ "key": "value" }', disabled: disabled, spellCheck: false, rows: 10 })] }));
};
