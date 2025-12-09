import { Outlet,Navigate } from "react-router-dom";
import { useAuth } from "../Context/authcontext";

export const VerifyUser = ()=>{
  const {authUser} = useAuth();
  console.log(`verify user is called..`);
  return authUser ? <Outlet/>:<Navigate to='/login'/>
}
/*<Outlet /> is a placeholder that React Router uses to render child routes.*/


/*
<Routes>
  <Route path="/login" element={<Login />} />

  <Route element={<verifyUser />}>
     <Route path="/" element={<Home />} />
     <Route path="/chat" element={<Chat />} />
     <Route path="/profile" element={<Profile />} />
  </Route>
</Routes>

to protect the child
If user is logged in → /chat works
If not logged in → /chat goes to /login
*/