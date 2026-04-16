import fetch from "node-fetch";
async function run() {
    const res = await fetch("http://localhost:5000/api/units/by-role?empId=99999999&roleId=04");
    const json = await res.json();
    console.log(JSON.stringify(json.data.slice(0, 10), null, 2));
}
run();
