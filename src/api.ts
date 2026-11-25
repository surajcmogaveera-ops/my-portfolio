const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export async function request<T>(path:string, options:RequestInit={}) {
  const response=await fetch(`${API}${path}`,{...options,credentials:'include',headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error?.message||`Request failed (${response.status})`);
  return body.data as T;
}
export const api={
  get:<T,>(path:string)=>request<T>(path),
  save:<T,>(path:string,data:unknown,method='PUT')=>request<T>(path,{method,body:JSON.stringify(data)}),
  remove:<T,>(path:string)=>request<T>(path,{method:'DELETE'}),
};
