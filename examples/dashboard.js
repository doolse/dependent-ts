import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";

export default (props) => {
  const salesData = [
    {
    id: 1,
    product: "Widget A",
    category: "Electronics",
    amount: 150,
    quantity: 3
  },
    {
    id: 2,
    product: "Widget B",
    category: "Electronics",
    amount: 200,
    quantity: 2
  },
    {
    id: 3,
    product: "Gadget X",
    category: "Accessories",
    amount: 50,
    quantity: 10
  },
    {
    id: 4,
    product: "Gadget Y",
    category: "Accessories",
    amount: 75,
    quantity: 5
  },
    {
    id: 5,
    product: "Device Z",
    category: "Electronics",
    amount: 300,
    quantity: 1
  },
    {
    id: 6,
    product: "Tool A",
    category: "Hardware",
    amount: 25,
    quantity: 20
  },
    {
    id: 7,
    product: "Tool B",
    category: "Hardware",
    amount: 40,
    quantity: 15
  }
  ];
  const [filterCategory, setFilterCategory] = useState("All");
  const categories = ["All", "Electronics", "Accessories", "Hardware"];
  const filterByCategory = (cat) => (item) => cat === "All" ? true : item.category === cat;
  const filteredData = salesData.filter(filterByCategory(filterCategory));
  const sumField = function sumRec(arr, field, idx) { return idx >= arr.length ? 0 : (() => {
    const item = arr[idx];
    return (() => {
      const value = field === "amount" ? item.amount * item.quantity : item.quantity;
      return value + sumRec(arr, field, idx + 1);
    })();
  })(); };
  const totalRevenue = sumField(filteredData, "amount", 0);
  const totalQuantity = sumField(filteredData, "quantity", 0);
  const findMax = function maxRec(arr, idx, currentMax) { return idx >= arr.length ? currentMax : (() => {
    const item = arr[idx];
    return (() => {
      const value = item.amount * item.quantity;
      return (() => {
        const newMax = value > currentMax ? value : currentMax;
        return maxRec(arr, idx + 1, newMax);
      })();
    })();
  })(); };
  const maxSale = findMax(filteredData, 0, 0);
  const cardStyle = {
    backgroundColor: "white",
    padding: "20px",
    borderRadius: "8px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    textAlign: "center"
  };
  return jsx("div", {
    style: {
    fontFamily: "system-ui",
    padding: "20px",
    backgroundColor: "#f5f5f5",
    minHeight: "100vh"
  },
    children: jsxs("div", {
    style: { maxWidth: "900px", margin: "0 auto" },
    children: [
    jsx("h1", { children: "Sales Dashboard" }),
    jsxs("div", {
    style: {
    backgroundColor: "#e8f5e9",
    padding: "15px",
    borderRadius: "8px",
    marginBottom: "20px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Language Features Demonstrated"
  }),
    jsxs("ul", {
    style: { margin: 0, paddingLeft: "20px", fontSize: "14px" },
    children: [
    jsx("li", {
    children: "Higher-order functions(filterByCategory returns a function)"
  }),
    jsx("li", { children: "Array methods:filter,map" }),
    jsx("li", { children: "Recursive sum/max calculations" }),
    jsx("li", { children: "Object destructuring and field access" }),
    jsx("li", { children: "Functional data transformation pipeline" })
  ]
  })
  ]
  }),
    jsxs("div", {
    style: { marginBottom: "20px" },
    children: [
    jsx("label", {
    style: { marginRight: "10px", fontWeight: "bold" },
    children: "Filter by Category:"
  }),
    categories.map((cat) => jsx("button", {
    style: {
    padding: "8px 16px",
    marginRight: "5px",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    backgroundColor: filterCategory === cat ? "#2196F3" : "#e0e0e0",
    color: filterCategory === cat ? "white" : "black"
  },
    onClick: () => setFilterCategory(cat),
    children: cat
  }))
  ]
  }),
    jsxs("div", {
    style: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "15px",
    marginBottom: "20px"
  },
    children: [
    jsxs("div", {
    style: cardStyle,
    children: [
    jsx("div", {
    style: { fontSize: "14px", color: "#666" },
    children: "Total Revenue"
  }),
    jsx("div", {
    style: { fontSize: "28px", fontWeight: "bold", color: "#4CAF50" },
    children: "$" + totalRevenue.toString()
  })
  ]
  }),
    jsxs("div", {
    style: cardStyle,
    children: [
    jsx("div", {
    style: { fontSize: "14px", color: "#666" },
    children: "Total Items"
  }),
    jsx("div", {
    style: { fontSize: "28px", fontWeight: "bold", color: "#2196F3" },
    children: totalQuantity.toString()
  })
  ]
  }),
    jsxs("div", {
    style: cardStyle,
    children: [
    jsx("div", {
    style: { fontSize: "14px", color: "#666" },
    children: "Largest Sale"
  }),
    jsx("div", {
    style: { fontSize: "28px", fontWeight: "bold", color: "#FF9800" },
    children: "$" + maxSale.toString()
  })
  ]
  }),
    jsxs("div", {
    style: cardStyle,
    children: [
    jsx("div", {
    style: { fontSize: "14px", color: "#666" },
    children: "Products"
  }),
    jsx("div", {
    style: { fontSize: "28px", fontWeight: "bold", color: "#9C27B0" },
    children: filteredData.length.toString()
  })
  ]
  })
  ]
  }),
    jsx("div", {
    style: {
    backgroundColor: "white",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
  },
    children: jsxs("table", {
    style: { width: "100%", borderCollapse: "collapse" },
    children: [
    jsx("thead", {
    children: jsxs("tr", {
    style: { backgroundColor: "#2196F3", color: "white" },
    children: [
    jsx("th", {
    style: { padding: "12px", textAlign: "left" },
    children: "Product"
  }),
    jsx("th", {
    style: { padding: "12px", textAlign: "left" },
    children: "Category"
  }),
    jsx("th", {
    style: { padding: "12px", textAlign: "right" },
    children: "Price"
  }),
    jsx("th", {
    style: { padding: "12px", textAlign: "right" },
    children: "Qty"
  }),
    jsx("th", {
    style: { padding: "12px", textAlign: "right" },
    children: "Total"
  })
  ]
  })
  }),
    jsx("tbody", {
    children: filteredData.map((item) => jsxs("tr", {
    style: { borderBottom: "1px solid #eee" },
    children: [
    jsx("td", { style: { padding: "12px" }, children: item.product }),
    jsx("td", {
    style: { padding: "12px" },
    children: jsx("span", {
    style: {
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    backgroundColor: item.category === "Electronics" ? "#e3f2fd" : item.category === "Accessories" ? "#fce4ec" : "#fff3e0",
    color: item.category === "Electronics" ? "#1565c0" : item.category === "Accessories" ? "#c2185b" : "#e65100"
  },
    children: item.category
  })
  }),
    jsx("td", {
    style: { padding: "12px", textAlign: "right" },
    children: "$" + item.amount.toString()
  }),
    jsx("td", {
    style: { padding: "12px", textAlign: "right" },
    children: item.quantity.toString()
  }),
    jsx("td", {
    style: { padding: "12px", textAlign: "right", fontWeight: "bold" },
    children: "$" + (item.amount * item.quantity).toString()
  })
  ]
  }))
  })
  ]
  })
  }),
    jsxs("div", {
    style: {
    marginTop: "20px",
    padding: "15px",
    backgroundColor: "#fff3e0",
    borderRadius: "8px"
  },
    children: [
    jsx("h3", {
    style: { margin: "0 0 10px 0" },
    children: "Code Highlights"
  }),
    jsx("p", {
    style: { margin: 0, fontSize: "12px" },
    children: "This dashboard uses higher-order functions like filterByCategory which returns a function,and recursive functions like sumField for calculating totals."
  })
  ]
  })
  ]
  })
  });
};
