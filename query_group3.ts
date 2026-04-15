import fs from 'fs';

async function fetchGroup3() {
    try {
        const res = await fetch("http://localhost:5000/api/report/report1?effectiveDate=2026-04-01&employeeId=99999999&userGroupNo=04");
        const payload = await res.json();
        
        if (payload.data) {
            const group3 = payload.data.filter((r: any) => r.GroupBGName && r.GroupBGName.includes("ธุรกิจใหม่"));
            // write it to a clean json file to read
            fs.writeFileSync('/tmp/group3.json', JSON.stringify(group3, null, 2));
        }
    } catch(e) {
        console.error(e);
    }
}
fetchGroup3();
