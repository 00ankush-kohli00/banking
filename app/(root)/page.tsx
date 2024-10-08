import React from "react";
import HeaderBox from "../../components/HeaderBox";
import TotalBalaceBox from "../../components/TotalBalaceBox";
import RightSidebar from "../../components/RightSidebar";
import { getLoggedInUser } from "../../lib/actions/user.action";
// import { getLoggedInUser } from "../../lib/actions/user.action";

const Home = async () => {
  const loggedIn = await getLoggedInUser();
  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">  
          <HeaderBox
            type="greeting"
            title="Welcome"
            user={loggedIn?.name || "Guest"}
            subtext="Access and manage your account and transaction efficiently."
          />
          <TotalBalaceBox
            accounts={[]}
            totalBanks={1}
            totalCurrentBalance={1250.35}
          />
        </header>
        RECENT TRANSACTION
      </div>
      <RightSidebar
        user={loggedIn}
        transactions={[]}
        banks={[{ currentBalance: 123.5 }, { currentBalance: 1243.9 }]}
      />
    </section>
  );
};

export default Home;
